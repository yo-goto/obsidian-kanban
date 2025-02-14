import React from 'react';
import useOnclickOutside from 'react-cool-onclickoutside';

import { t } from 'src/lang/helpers';

import { KanbanContext } from '../context';
import { getDropAction, handlePaste } from '../Editor/helpers';
import { MarkdownEditor, allowNewLine } from '../Editor/MarkdownEditor';
import { c } from '../helpers';
import { Item } from '../types';

interface ItemFormProps {
  addItems: (items: Item[]) => void;
  isInputVisible: boolean;
  setIsInputVisible: React.Dispatch<React.SetStateAction<boolean>>;
  hideButton?: boolean;
}

export function ItemForm({
  addItems,
  isInputVisible,
  setIsInputVisible,
  hideButton,
}: ItemFormProps) {
  const [itemTitle, setItemTitle] = React.useState('');
  const { stateManager } = React.useContext(KanbanContext);
  const inputRef = React.useRef<HTMLTextAreaElement>();

  const clickOutsideRef = useOnclickOutside(
    () => {
      setIsInputVisible(false);
    },
    {
      ignoreClass: c('ignore-click-outside'),
    }
  );

  const clear = React.useCallback(() => {
    setItemTitle('');
    setIsInputVisible(false);
  }, []);

  const addItemsFromStrings = async (titles: string[]) => {
    addItems(
      await Promise.all(
        titles.map(async (title) => {
          return await stateManager.getNewItem(title);
        })
      )
    );
  };

  const onEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!allowNewLine(e, stateManager)) {
      e.preventDefault();

      const title = itemTitle.trim();

      if (title) {
        addItemsFromStrings([title]);
        setItemTitle('');
      }
    }
  };

  if (isInputVisible) {
    return (
      <div className={c('item-form')} ref={clickOutsideRef}>
        <div className={c('item-input-wrapper')}>
          <MarkdownEditor
            ref={inputRef}
            className={c('item-input')}
            placeholder={t('Card title...')}
            onEnter={onEnter}
            onEscape={clear}
            value={itemTitle}
            onChange={(e) => {
              setItemTitle((e.target as HTMLTextAreaElement).value);
            }}
            onPaste={(e) => {
              handlePaste(e, stateManager);
            }}
          />
        </div>
      </div>
    );
  }

  if (hideButton) return null;

  return (
    <div className={c('item-button-wrapper')}>
      <button
        className={c('new-item-button')}
        onClick={() => setIsInputVisible(true)}
        onDragOver={(e) => {
          if (getDropAction(stateManager, e.dataTransfer)) {
            setIsInputVisible(true);
          }
        }}
      >
        <span className={c('item-button-plus')}>+</span> {t('Add a card')}
      </button>
    </div>
  );
}
