import React, { useEffect, useRef } from 'react';
import { useManuscriptStore } from '../../stores/manuscriptStore';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';

interface DraggableSceneItemProps {
  scene: any;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}

const DraggableSceneItem: React.FC<DraggableSceneItemProps> = ({ 
  scene, 
  index, 
  isSelected, 
  onSelect 
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isDropTarget, setIsDropTarget] = React.useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return combine(
      draggable({
        element,
        getInitialData: () => ({ sceneId: scene.id, index }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.sceneId !== scene.id,
        onDragEnter: () => setIsDropTarget(true),
        onDragLeave: () => setIsDropTarget(false),
        onDrop: () => setIsDropTarget(false),
      })
    );
  }, [scene.id, index]);

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={`p-3 rounded-lg border cursor-pointer transition-all duration-200 ${
        isDragging 
          ? 'opacity-50 scale-95 border-blue-300 bg-blue-50' 
          : isDropTarget
          ? 'border-blue-500 bg-blue-50 scale-105'
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
    </div>
  );
};

const SceneReorderer: React.FC = () => {
  const { manuscript, selectedSceneId, selectScene, reorderScenes } = useManuscriptStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      onDrop: ({ source, location }) => {
        const target = location.current.dropTargets[0];
        if (!target) return;

        const sourceIndex = source.data.index as number;
        const targetIndex = target.data.index as number;

        if (sourceIndex === targetIndex) return;

        if (!manuscript) return;

        // Reorder the scenes
        const newOrder = reorder({
          list: manuscript.currentOrder,
          startIndex: sourceIndex,
          finishIndex: targetIndex,
        });

        reorderScenes(newOrder);
      },
    });
  }, [manuscript, reorderScenes]);

  if (!manuscript) {
    return null;
  }

  // Get scenes in current order
  const orderedScenes = manuscript.currentOrder.map(id => 
    manuscript.scenes.find(scene => scene.id === id)
  ).filter(Boolean);

  return (
    <div className="h-full overflow-auto">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-900">Scene Order</h3>
          <div className="text-xs text-gray-500">
            Drag to reorder
          </div>
        </div>
        <div ref={containerRef} className="space-y-2">
          {orderedScenes.map((scene, index) => (
            <DraggableSceneItem
              key={scene!.id}
              scene={scene}
              index={index}
              isSelected={selectedSceneId === scene!.id}
              onSelect={() => selectScene(scene!.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SceneReorderer;

