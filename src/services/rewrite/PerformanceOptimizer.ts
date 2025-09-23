export interface PerformanceMetrics {
  avgRewriteTime: number;
  cacheHitRate: number;
  memoryUsage: number;
  errorRate: number;
  lastUpdated: number;
}

class PerformanceOptimizer {
  private metrics: PerformanceMetrics = {
    avgRewriteTime: 0,
    cacheHitRate: 0,
    memoryUsage: 0,
    errorRate: 0,
    lastUpdated: Date.now()
  };
  
  private rewriteTimes: number[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;
  private errors = 0;
  private total = 0;
  
  /**
   * Track rewrite performance
   */
  trackRewrite(startTime: number, success: boolean, cached: boolean = false): void {
    const duration = Date.now() - startTime;
    this.total++;
    
    if (success) {
      this.rewriteTimes.push(duration);
      // Keep only last 100 times for moving average
      if (this.rewriteTimes.length > 100) {
        this.rewriteTimes.shift();
      }
    } else {
      this.errors++;
    }
    
    if (cached) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
    
    this.updateMetrics();
  }
  
  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Suggest optimizations based on current metrics
   */
  getSuggestions(): string[] {
    const suggestions: string[] = [];
    
    if (this.metrics.avgRewriteTime > 30000) {
      suggestions.push('Consider using simpler models for basic issues');
    }
    
    if (this.metrics.cacheHitRate < 0.3 && this.total > 10) {
      suggestions.push('Low cache hit rate - ensure cache is properly configured');
    }
    
    if (this.metrics.errorRate > 0.1) {
      suggestions.push('High error rate detected - check API keys and network');
    }
    
    if (this.metrics.memoryUsage > 500) {
      suggestions.push('High memory usage - consider clearing old rewrites');
    }
    
    return suggestions;
  }
  
  /**
   * Optimize batch size based on performance
   */
  getOptimalBatchSize(): number {
    if (this.metrics.avgRewriteTime < 5000) {
      return 10; // Fast processing, larger batches OK
    } else if (this.metrics.avgRewriteTime < 15000) {
      return 5; // Medium speed
    } else {
      return 3; // Slow processing, smaller batches
    }
  }
  
  /**
   * Clean up old data to free memory
   */
  cleanup(): void {
    // Clear old metrics
    if (this.rewriteTimes.length > 100) {
      this.rewriteTimes = this.rewriteTimes.slice(-100);
    }
    
    // Reset counters periodically
    if (this.total > 1000) {
      const hitRate = this.metrics.cacheHitRate;
      const errorRate = this.metrics.errorRate;
      
      // Reset but maintain ratios
      this.cacheHits = Math.round(hitRate * 100);
      this.cacheMisses = Math.round((1 - hitRate) * 100);
      this.errors = Math.round(errorRate * 100);
      this.total = 100;
    }
  }
  
  private updateMetrics(): void {
    // Calculate average rewrite time
    if (this.rewriteTimes.length > 0) {
      const sum = this.rewriteTimes.reduce((a, b) => a + b, 0);
      this.metrics.avgRewriteTime = Math.round(sum / this.rewriteTimes.length);
    }
    
    // Calculate cache hit rate
    const cacheTotal = this.cacheHits + this.cacheMisses;
    if (cacheTotal > 0) {
      this.metrics.cacheHitRate = this.cacheHits / cacheTotal;
    }
    
    // Calculate error rate
    if (this.total > 0) {
      this.metrics.errorRate = this.errors / this.total;
    }
    
    // Estimate memory usage (simplified)
    if (typeof process !== 'undefined' && (process as any).memoryUsage) {
      const usage = (process as any).memoryUsage();
      this.metrics.memoryUsage = Math.round(usage.heapUsed / 1024 / 1024); // MB
    }
    
    this.metrics.lastUpdated = Date.now();
  }
}

export default PerformanceOptimizer;