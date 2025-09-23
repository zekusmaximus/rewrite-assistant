import type { Manuscript, Scene, RewriteVersion } from '../../shared/types';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface ExportOptions {
  format: 'original' | 'rewritten' | 'both' | 'changelog';
  includeMetadata: boolean;
  includeChangeLog: boolean;
  changeLogDetail: 'summary' | 'detailed';
  outputPath?: string;
  filename?: string;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  stats?: {
    totalScenes: number;
    rewrittenScenes: number;
    totalWords: number;
    totalChanges: number;
  };
}

export interface ChangeLogEntry {
  sceneNumber: number;
  sceneTitle: string;
  changes: {
    issueType: string;
    description: string;
    fix: string;
  }[];
  wordCountBefore: number;
  wordCountAfter: number;
  modelUsed?: string;
  timestamp?: number;
}

class ManuscriptExporter {
  /**
   * Export manuscript with various format options
   */
  async exportManuscript(
    manuscript: Manuscript,
    rewrites: Map<string, RewriteVersion[]>,
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      const stats = this.calculateStats(manuscript, rewrites);
      
      let content: string;
      switch (options.format) {
        case 'original':
          content = this.exportOriginal(manuscript);
          break;
        case 'rewritten':
          content = this.exportRewritten(manuscript, rewrites);
          break;
        case 'both':
          content = this.exportBothVersions(manuscript, rewrites, options);
          break;
        case 'changelog':
          content = this.exportChangeLog(manuscript, rewrites, options);
          break;
        default:
          content = this.exportRewritten(manuscript, rewrites);
      }
      
      // Add metadata header if requested
      if (options.includeMetadata) {
        content = this.addMetadataHeader(manuscript, stats, options) + content;
      }
      
      // Add change log section if requested
      if (options.includeChangeLog && options.format !== 'changelog') {
        content += this.generateChangeLogSection(manuscript, rewrites, options);
      }
      
      // Determine output path
      const outputPath = options.outputPath || process.cwd();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const defaultFilename = `${manuscript.title || 'manuscript'}_${options.format}_${timestamp}.txt`;
      const filename = options.filename || defaultFilename;
      const filePath = path.join(outputPath, filename);
      
      // Write file
      await fs.writeFile(filePath, content, 'utf-8');
      
      return {
        success: true,
        filePath,
        stats
      };
      
    } catch (error) {
       
      console.error('[ManuscriptExporter] Export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed'
      };
    }
  }
  
  private exportOriginal(manuscript: Manuscript): string {
    const orderedScenes = this.getOrderedScenes(manuscript);
    return orderedScenes
      .map(scene => scene.text)
      .join('\n\n### SCENE BREAK ###\n\n');
  }
  
  private exportRewritten(
    manuscript: Manuscript,
    rewrites: Map<string, RewriteVersion[]>
  ): string {
    const orderedScenes = this.getOrderedScenes(manuscript);
    
    return orderedScenes
      .map(scene => {
        // Use applied rewrite if available, otherwise original
        if (scene.rewriteStatus === 'approved') {
          // Scene text was already updated with rewrite
          return scene.text;
        }
        
        // Check for unapplied rewrites
        const sceneRewrites = rewrites.get(scene.id);
        const latestRewrite = sceneRewrites?.[sceneRewrites.length - 1];
        
        if (latestRewrite && latestRewrite.rewrittenText) {
          return latestRewrite.rewrittenText;
        }
        
        return scene.text;
      })
      .join('\n\n### SCENE BREAK ###\n\n');
  }
  
  private exportBothVersions(
    manuscript: Manuscript,
    rewrites: Map<string, RewriteVersion[]>,
    options: ExportOptions
  ): string {
    const sections: string[] = [];
    
    // Add table of contents
    sections.push('TABLE OF CONTENTS\n' + '='.repeat(50) + '\n');
    sections.push('Original Version ............... Page 1');
    sections.push('Rewritten Version .............. Page 2');
    if (options.includeChangeLog) {
      sections.push('Change Log ..................... Page 3');
    }
    sections.push('\n\n');
    
    // Original version
    sections.push('ORIGINAL VERSION\n' + '='.repeat(50) + '\n\n');
    sections.push(this.exportOriginal(manuscript));
    sections.push('\n\n' + '='.repeat(50) + '\n\n');
    
    // Rewritten version
    sections.push('REWRITTEN VERSION\n' + '='.repeat(50) + '\n\n');
    sections.push(this.exportRewritten(manuscript, rewrites));
    
    return sections.join('');
  }
  
  private exportChangeLog(
    manuscript: Manuscript,
    rewrites: Map<string, RewriteVersion[]>,
    options: ExportOptions
  ): string {
    const entries = this.buildChangeLogEntries(manuscript, rewrites);
    
    const sections: string[] = [
      'MANUSCRIPT CHANGE LOG',
      '='.repeat(50),
      `Generated: ${new Date().toLocaleString()}`,
      `Total Scenes: ${manuscript.scenes.length}`,
      `Scenes Rewritten: ${entries.length}`,
      '',
      '='.repeat(50),
      ''
    ];
    
    if (entries.length === 0) {
      sections.push('No scenes have been rewritten.');
      return sections.join('\n');
    }
    
    // Add entries
    entries.forEach((entry, index) => {
      sections.push(`\nSCENE ${entry.sceneNumber}`);
      sections.push('-'.repeat(30));
      
      if (entry.sceneTitle) {
        sections.push(`Title: ${entry.sceneTitle}`);
      }
      
      sections.push(`Word Count: ${entry.wordCountBefore} → ${entry.wordCountAfter} (${
        entry.wordCountAfter - entry.wordCountBefore > 0 ? '+' : ''
      }${entry.wordCountAfter - entry.wordCountBefore})`);
      
      if (entry.modelUsed) {
        sections.push(`AI Model: ${entry.modelUsed}`);
      }
      
      sections.push('\nChanges Made:');
      entry.changes.forEach(change => {
        sections.push(`  • ${change.issueType.toUpperCase()}: ${change.description}`);
        if (options.changeLogDetail === 'detailed' && change.fix) {
          sections.push(`    → ${change.fix}`);
        }
      });
      
      if (index < entries.length - 1) {
        sections.push('');
      }
    });
    
    return sections.join('\n');
  }
  
  private generateChangeLogSection(
    manuscript: Manuscript,
    rewrites: Map<string, RewriteVersion[]>,
    options: ExportOptions
  ): string {
    const changeLog = this.exportChangeLog(manuscript, rewrites, options);
    return '\n\n' + '='.repeat(50) + '\n\n' + changeLog;
  }
  
  private addMetadataHeader(
    manuscript: Manuscript,
    stats: ExportResult['stats'],
    options: ExportOptions
  ): string {
    const header: string[] = [
      '='.repeat(50),
      'MANUSCRIPT EXPORT',
      '='.repeat(50),
      `Title: ${manuscript.title || 'Untitled'}`,
      `Export Date: ${new Date().toLocaleString()}`,
      `Export Format: ${options.format}`,
      `Total Scenes: ${stats?.totalScenes || 0}`,
      `Rewritten Scenes: ${stats?.rewrittenScenes || 0}`,
      `Total Words: ${stats?.totalWords || 0}`,
      '='.repeat(50),
      '\n\n'
    ];
    
    return header.join('\n');
  }
  
  private buildChangeLogEntries(
    manuscript: Manuscript,
    rewrites: Map<string, RewriteVersion[]>
  ): ChangeLogEntry[] {
    const entries: ChangeLogEntry[] = [];
    const orderedScenes = this.getOrderedScenes(manuscript);
    
    orderedScenes.forEach((scene, index) => {
      const sceneRewrites = rewrites.get(scene.id);
      const latestRewrite = sceneRewrites?.[sceneRewrites.length - 1];
      
      if (latestRewrite && (scene.rewriteStatus === 'approved' || latestRewrite.rewrittenText)) {
        const entry: ChangeLogEntry = {
          sceneNumber: index + 1,
          sceneTitle: this.extractSceneTitle(scene.text),
          changes: latestRewrite.issuesAddressed.map(issue => ({
            issueType: issue.type,
            description: issue.description,
            fix: issue.suggestedFix || 'Applied contextual fix'
          })),
          wordCountBefore: scene.wordCount,
          wordCountAfter: this.countWords(
            scene.rewriteStatus === 'approved' ? scene.text : latestRewrite.rewrittenText
          ),
          modelUsed: latestRewrite.modelUsed,
          timestamp: latestRewrite.timestamp
        };
        
        entries.push(entry);
      }
    });
    
    return entries;
  }
  
  private getOrderedScenes(manuscript: Manuscript): Scene[] {
    return manuscript.currentOrder
      .map(id => manuscript.scenes.find(s => s.id === id))
      .filter(Boolean) as Scene[];
  }
  
  private calculateStats(
    manuscript: Manuscript,
    rewrites: Map<string, RewriteVersion[]>
  ): ExportResult['stats'] {
    const rewrittenScenes = manuscript.scenes.filter(scene => 
      scene.rewriteStatus === 'approved' || rewrites.has(scene.id)
    );
    
    const totalWords = manuscript.scenes.reduce((sum, scene) => {
      if (scene.rewriteStatus === 'approved') {
        return sum + scene.wordCount;
      }
      const rewrite = rewrites.get(scene.id)?.[0];
      if (rewrite?.rewrittenText) {
        return sum + this.countWords(rewrite.rewrittenText);
      }
      return sum + scene.wordCount;
    }, 0);
    
    const totalChanges = Array.from(rewrites.values())
      .reduce((sum, versions) => {
        const latest = versions[versions.length - 1];
        return sum + (latest?.issuesAddressed.length || 0);
      }, 0);
    
    return {
      totalScenes: manuscript.scenes.length,
      rewrittenScenes: rewrittenScenes.length,
      totalWords,
      totalChanges
    };
  }
  
  private extractSceneTitle(text: string): string {
    const firstLine = text.split('\n')[0];
    if (firstLine && firstLine.length < 100) {
      return firstLine.trim();
    }
    return text.substring(0, 50).trim() + '...';
  }
  
  private countWords(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }
}

export default ManuscriptExporter;