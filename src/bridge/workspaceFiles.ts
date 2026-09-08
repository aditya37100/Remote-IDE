import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface FileNode {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

export interface DiffEntry {
  file: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
  diff: string;
}

const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  '.vscode',
  '.vscode-test',
  '.DS_Store',
  'Thumbs.db'
]);

export class WorkspaceManager {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  public setWorkspaceRoot(newRoot: string) {
    this.workspaceRoot = path.resolve(newRoot);
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private isSafePath(targetPath: string): boolean {
    const resolved = path.resolve(this.workspaceRoot, targetPath);
    return resolved.startsWith(this.workspaceRoot);
  }

  public async getFileTree(maxDepth = 3, currentDir = '', depth = 0): Promise<FileNode[]> {
    if (depth > maxDepth) {
      return [];
    }

    const absDir = path.resolve(this.workspaceRoot, currentDir);
    if (!this.isSafePath(absDir) || !fs.existsSync(absDir)) {
      return [];
    }

    try {
      const entries = await fs.promises.readdir(absDir, { withFileTypes: true });
      const nodes: FileNode[] = [];

      for (const entry of entries) {
        if (IGNORED_NAMES.has(entry.name)) {
          continue;
        }

        const relPath = currentDir ? path.join(currentDir, entry.name).replace(/\\/g, '/') : entry.name;
        if (entry.isDirectory()) {
          const children = await this.getFileTree(maxDepth, relPath, depth + 1);
          nodes.push({
            name: entry.name,
            relativePath: relPath,
            type: 'directory',
            children
          });
        } else if (entry.isFile()) {
          let size = 0;
          try {
            const stat = await fs.promises.stat(path.resolve(absDir, entry.name));
            size = stat.size;
          } catch {
            // ignore
          }
          nodes.push({
            name: entry.name,
            relativePath: relPath,
            type: 'file',
            size
          });
        }
      }

      // Sort directories first, then files alphabetically
      nodes.sort((a, b) => {
        if (a.type === b.type) {
          return a.name.localeCompare(b.name);
        }
        return a.type === 'directory' ? -1 : 1;
      });

      return nodes;
    } catch (err) {
      console.error('[WorkspaceManager] Error reading file tree:', err);
      return [];
    }
  }

  public async getFileContent(relativePath: string): Promise<{ content: string; language: string } | null> {
    const absPath = path.resolve(this.workspaceRoot, relativePath);
    if (!this.isSafePath(absPath) || !fs.existsSync(absPath)) {
      return null;
    }

    const stat = await fs.promises.stat(absPath);
    // Limit to 2MB to prevent mobile memory exhaustion
    if (stat.size > 2 * 1024 * 1024) {
      return {
        content: `// File is too large to display on mobile (${(stat.size / 1024 / 1024).toFixed(1)} MB)`,
        language: 'plaintext'
      };
    }

    const ext = path.extname(absPath).toLowerCase().replace('.', '');
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      json: 'json',
      html: 'html',
      css: 'css',
      md: 'markdown',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      sh: 'shell',
      yaml: 'yaml',
      yml: 'yaml'
    };

    try {
      const content = await fs.promises.readFile(absPath, 'utf8');
      return {
        content,
        language: languageMap[ext] || 'plaintext'
      };
    } catch (err) {
      console.error('[WorkspaceManager] Error reading file:', err);
      return null;
    }
  }

  public async getGitDiff(): Promise<DiffEntry[]> {
    try {
      // Check if git repository exists
      const gitDir = path.join(this.workspaceRoot, '.git');
      if (!fs.existsSync(gitDir)) {
        return [];
      }

      const { stdout: statusOutput } = await execAsync('git status --porcelain', {
        cwd: this.workspaceRoot
      });

      if (!statusOutput.trim()) {
        return [];
      }

      const entries: DiffEntry[] = [];
      const lines = statusOutput.split('\n').filter((l) => l.trim().length > 0);

      for (const line of lines) {
        const statusCode = line.substring(0, 2).trim();
        const filePath = line.substring(3).trim().replace(/"/g, '');

        let status: DiffEntry['status'] = 'modified';
        if (statusCode === '?' || statusCode === '??') {
          status = 'untracked';
        } else if (statusCode === 'A') {
          status = 'added';
        } else if (statusCode === 'D') {
          status = 'deleted';
        }

        let diff = '';
        if (status !== 'untracked') {
          try {
            const { stdout: diffOutput } = await execAsync(`git diff "${filePath}"`, {
              cwd: this.workspaceRoot
            });
            diff = diffOutput;
          } catch {
            diff = '';
          }
        }

        entries.push({
          file: filePath,
          status,
          diff
        });
      }

      return entries;
    } catch (err) {
      console.error('[WorkspaceManager] Error getting git diff:', err);
      return [];
    }
  }
}
