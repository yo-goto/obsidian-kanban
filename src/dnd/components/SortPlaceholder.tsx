import classcat from 'classcat';
import React from 'react';

import { c, generateInstanceId } from 'src/components/helpers';

import { EntityData } from '../types';
import { Droppable } from './Droppable';

interface SortPlaceholderProps {
  index: number;
  accepts: string[];
  className?: string;
  isStatic?: boolean;
}

export function SortPlaceholder({
  index,
  accepts,
  className,
  isStatic,
}: SortPlaceholderProps) {
  const elementRef = React.useRef<HTMLDivElement>(null);
  const measureRef = React.useRef<HTMLDivElement>(null);

  const data = React.useMemo<EntityData>(() => {
    return {
      id: generateInstanceId(),
      type: 'placeholder',
      accepts,
    };
  }, accepts);

  return (
    <div ref={measureRef} className={classcat([className, c('placeholder')])}>
      <div ref={elementRef}>
        {!isStatic && (
          <Droppable
            elementRef={elementRef}
            measureRef={measureRef}
            id={data.id}
            index={index}
            data={data}
          />
        )}
      </div>
    </div>
  );
}
