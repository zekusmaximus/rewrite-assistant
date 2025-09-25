import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useManuscriptStore } from '../../stores/manuscriptStore';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import useRewriteStore from '../rewrite/stores/rewriteStore';
import { useConsultationStore } from '../consultation/stores/consultationStore';

interface DraggableSceneItemProps {
  scene: any;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onOpenConsultation?: (sceneId: string) => void;
}

interface InsertionDropZoneProps {
  index: number;
  isActive: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
}

const InsertionDropZone: React.FC<InsertionDropZoneProps> = ({
  index,
  isActive,
  onDragEnter,
  onDragLeave
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      getData: () => ({ insertionIndex: index }),
      onDragEnter,
      onDragLeave,
    });
  }, [index, onDragEnter, onDragLeave]);

  return (
    <div
      ref={ref}
      className="w-full h-3 flex items-center justify-center transition-all duration-100"
    >
      {isActive && (
        <div className="w-full h-0.5 bg-blue-500 rounded-full transition-all duration-100" />
      )}
    </div>
  );
};

const DraggableSceneItem: React.FC<DraggableSceneItemProps> = ({
  scene,
  index,
  isSelected,
  onSelect,
  onOpenConsultation
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const { hasRewrite } = useRewriteStore();
  const hasRewriteReady = hasRewrite(scene.id);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return draggable({
      element,
      getInitialData: () => ({ sceneId: scene.id, index }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [scene.id, index]);

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
        isDragging
          ? 'opacity-50 scale-95 border-blue-300 bg-blue-50'
          : isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300'
      }`}
      style={{
        transform: isDragging ? 'rotate(2deg)' : 'none',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm font-medium text-gray-600">
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-900 truncate">
              Scene {index + 1}
            </div>
            <div className="text-xs text-gray-500">
              {scene.wordCount} words
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {scene.hasBeenMoved && (
            <div className="w-2 h-2 bg-yellow-400 rounded-full" title="Scene has been moved" />
          )}
          {onOpenConsultation && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenConsultation(scene.id);
              }}
              className="p-1 text-gray-400 hover:text-orange-600 transition-colors"
              title="Ask AI about this scene"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          )}
          <div className="text-gray-400 cursor-grab active:cursor-grabbing">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </div>
        </div>
      </div>
      
      {/* Scene preview */}
      <div className="mt-2 text-xs text-gray-600 line-clamp-2">
        {scene.text.substring(0, 100)}...
      </div>

      {/* Rewrite status indicators */}
      {scene.hasBeenMoved && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-amber-600">Moved</span>
          {hasRewriteReady && (
            <span className="text-xs text-green-600">Rewrite Available</span>
          )}
          {scene.rewriteStatus === 'approved' && (
            <span className="text-xs text-blue-600">Applied</span>
          )}
          {scene.rewriteStatus === 'rejected' && (
            <span className="text-xs text-red-600">Rejected</span>
          )}
        </div>
      )}
    </div>
  );
};

const SceneReorderer: React.FC = () => {
  const { manuscript, selectedSceneId, selectScene, reorderScenes } = useManuscriptStore();
  const { openPanel, selectScenes } = useConsultationStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [activeInsertionIndex, setActiveInsertionIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const autoScrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startAutoScroll = useCallback((direction: 'up' | 'down', speed: number) => {
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
    }

    autoScrollIntervalRef.current = setInterval(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const scrollAmount = Math.max(1, speed);
      if (direction === 'up') {
        container.scrollTop = Math.max(0, container.scrollTop - scrollAmount);
      } else {
        container.scrollTop = Math.min(
          container.scrollHeight - container.clientHeight,
          container.scrollTop + scrollAmount
        );
      }
    }, 16); // ~60fps
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }, []);

  const handleOpenConsultationForScene = useCallback((sceneId: string) => {
    // Pre-select the scene and open consultation panel
    selectScenes([sceneId]);
    openPanel();

    // Notify parent App component that consultation should be opened
    const event = new CustomEvent('openConsultation', { detail: { sceneId } });
    window.dispatchEvent(event);
  }, [selectScenes, openPanel]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY;
    const containerTop = rect.top;
    const containerBottom = rect.bottom;

    const edgeThreshold = 50;
    const distanceFromTop = mouseY - containerTop;
    const distanceFromBottom = containerBottom - mouseY;

    if (distanceFromTop < edgeThreshold && distanceFromTop > 0) {
      // Near top edge
      const speed = Math.max(1, (edgeThreshold - distanceFromTop) / 5);
      startAutoScroll('up', speed);
    } else if (distanceFromBottom < edgeThreshold && distanceFromBottom > 0) {
      // Near bottom edge
      const speed = Math.max(1, (edgeThreshold - distanceFromBottom) / 5);
      startAutoScroll('down', speed);
    } else {
      stopAutoScroll();
    }
  }, [isDragging, startAutoScroll, stopAutoScroll]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        stopAutoScroll();
      };
    }
  }, [isDragging, handleMouseMove, stopAutoScroll]);

  useEffect(() => {
    return () => {
      stopAutoScroll();
    };
  }, [stopAutoScroll]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      onDragStart: () => {
        setIsDragging(true);
        setActiveInsertionIndex(null);
      },
      onDrop: ({ source, location }) => {
        setIsDragging(false);
        setActiveInsertionIndex(null);
        stopAutoScroll();

        const target = location.current.dropTargets[0];
        if (!target || !manuscript) return;

        const sourceIndex = source.data.index as number;
        const insertionIndex = target.data.insertionIndex as number;

        if (insertionIndex === undefined || insertionIndex === null) return;

        // Calculate the actual target index for reordering
        let targetIndex = insertionIndex;
        if (sourceIndex < insertionIndex) {
          targetIndex = insertionIndex - 1;
        }

        if (sourceIndex === targetIndex) return;

        // Reorder the scenes
        const newOrder = reorder({
          list: manuscript.currentOrder,
          startIndex: sourceIndex,
          finishIndex: targetIndex,
        });

        reorderScenes(newOrder);
      },
    });
  }, [manuscript, reorderScenes, stopAutoScroll]);

  if (!manuscript) {
    return null;
  }

  // Get scenes in current order
  const orderedScenes = manuscript.currentOrder.map(id => 
    manuscript.scenes.find(scene => scene.id === id)
  ).filter(Boolean);

  return (
    <div ref={scrollContainerRef} className="h-full overflow-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-900">Scene Order</h3>
          <div className="text-xs text-gray-500">
            Drag to reorder
          </div>
        </div>
        <div ref={containerRef} className="space-y-0">
          {/* Top insertion zone */}
          <InsertionDropZone
            index={0}
            isActive={activeInsertionIndex === 0}
            onDragEnter={() => setActiveInsertionIndex(0)}
            onDragLeave={() => setActiveInsertionIndex(null)}
          />

          {orderedScenes.map((scene, index) => (
            <React.Fragment key={scene!.id}>
              <div className="mb-2">
                <DraggableSceneItem
                  scene={scene}
                  index={index}
                  isSelected={selectedSceneId === scene!.id}
                  onSelect={() => selectScene(scene!.id)}
                  onOpenConsultation={handleOpenConsultationForScene}
                />
              </div>

              {/* Insertion zone after each scene */}
              <InsertionDropZone
                index={index + 1}
                isActive={activeInsertionIndex === index + 1}
                onDragEnter={() => setActiveInsertionIndex(index + 1)}
                onDragLeave={() => setActiveInsertionIndex(null)}
              />
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SceneReorderer;

