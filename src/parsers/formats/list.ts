import update from 'immutability-helper';
import { Content, List, Parent, Root } from 'mdast';
import { ListItem, Paragraph } from 'mdast-util-from-markdown/lib';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';

import { generateInstanceId } from 'src/components/helpers';
import {
  Board,
  BoardTemplate,
  Item,
  ItemData,
  ItemTemplate,
  Lane,
  LaneTemplate,
} from 'src/components/types';
import { t } from 'src/lang/helpers';
import { KanbanSettings } from 'src/Settings';
import { StateManager } from 'src/StateManager';

import { archiveString, completeString, settingsToCodeblock } from '../common';
import { DateNode, FileNode, TimeNode, ValueNode } from '../extensions/types';
import {
  getNextOfType,
  getNodeContentBoundary,
  getPrevSibling,
  getStringFromBoundary,
} from '../helpers/ast';
import { hydrateItem } from '../helpers/hydrateBoard';
import { executeDeletion, markRangeForDeletion } from '../helpers/parser';
import { parseFragment } from '../parseMarkdown';
import { stringifyYaml } from 'obsidian';

export function listItemToItemData(md: string, item: ListItem) {
  const itemBoundary = getNodeContentBoundary(item.children[0] as Paragraph);
  const itemContent = getStringFromBoundary(md, itemBoundary);

  let title = itemContent;

  const itemData: ItemData = {
    titleRaw: itemContent.replace(/<br>/g, '\n'),
    blockId: undefined,
    title: '',
    titleSearch: '',
    metadata: {
      dateStr: undefined,
      date: undefined,
      time: undefined,
      timeStr: undefined,
      tags: [],
      fileAccessor: undefined,
      file: undefined,
      fileMetadata: undefined,
    },
    dom: undefined,
    isComplete: !!item.checked,
  };

  visit(
    item,
    (node) => {
      return node.type !== 'paragraph';
    },
    (node) => {
      const genericNode = node as ValueNode;

      if (genericNode.type === 'blockid') {
        itemData.blockId = genericNode.value;
        return true;
      }

      if (genericNode.type === 'hashtag') {
        if (!itemData.metadata.tags) {
          itemData.metadata.tags = [];
        }

        itemData.metadata.tags.push('#' + genericNode.value);
        title = markRangeForDeletion(title, {
          start: node.position.start.offset - itemBoundary.start,
          end: node.position.end.offset - itemBoundary.start,
        });
        return true;
      }

      if (genericNode.type === 'date' || genericNode.type === 'dateLink') {
        itemData.metadata.dateStr = (genericNode as DateNode).date;
        title = markRangeForDeletion(title, {
          start: node.position.start.offset - itemBoundary.start,
          end: node.position.end.offset - itemBoundary.start,
        });
        return true;
      }

      if (genericNode.type === 'time') {
        itemData.metadata.timeStr = (genericNode as TimeNode).time;
        title = markRangeForDeletion(title, {
          start: node.position.start.offset - itemBoundary.start,
          end: node.position.end.offset - itemBoundary.start,
        });
        return true;
      }

      if (genericNode.type === 'embedWikilink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        return true;
      }

      if (genericNode.type === 'wikilink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        itemData.metadata.fileMetadata = (genericNode as FileNode).fileMetadata;
        return true;
      }

      if (
        genericNode.type === 'link' &&
        (genericNode as FileNode).fileAccessor
      ) {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        itemData.metadata.fileMetadata = (genericNode as FileNode).fileMetadata;
        return true;
      }

      if (genericNode.type === 'embedLink') {
        itemData.metadata.fileAccessor = (genericNode as FileNode).fileAccessor;
        return true;
      }
    }
  );

  itemData.title = executeDeletion(title).replace(/<br>/g, '\n');

  return itemData;
}

function isArchiveLane(
  child: Content,
  children: Content[],
  currentIndex: number
) {
  if (
    child.type !== 'heading' ||
    toString(child, { includeImageAlt: false }) !== t('Archive')
  ) {
    return false;
  }

  const prev = getPrevSibling(children, currentIndex);

  return prev && prev.type === 'thematicBreak';
}

export function astToUnhydratedBoard(
  stateManager: StateManager,
  settings: KanbanSettings,
  frontmatter: Record<string, any>,
  root: Root,
  md: string
): Board {
  const lanes: Lane[] = [];
  const archive: Item[] = [];

  root.children.forEach((child, index) => {
    if (child.type === 'heading') {
      const isArchive = isArchiveLane(child, root.children, index);
      const headingBoundary = getNodeContentBoundary(child as Parent);
      const title = getStringFromBoundary(md, headingBoundary);

      let shouldMarkItemsComplete = false;

      const list = getNextOfType(root.children, index, 'list', (child) => {
        if (child.type === 'heading') return false;

        if (child.type === 'paragraph') {
          const childStr = toString(child);

          if (childStr.startsWith('%% kanban:settings')) {
            return false;
          }

          if (childStr === t('Complete')) {
            shouldMarkItemsComplete = true;
            return true;
          }
        }

        return true;
      });

      if (isArchive && list) {
        archive.push(
          ...(list as List).children.map((listItem) => {
            return {
              ...ItemTemplate,
              id: generateInstanceId(),
              data: listItemToItemData(md, listItem),
            };
          })
        );

        return;
      }

      if (!list) {
        lanes.push({
          ...LaneTemplate,
          children: [],
          id: generateInstanceId(),
          data: {
            title,
            shouldMarkItemsComplete,
          },
        });
      } else {
        lanes.push({
          ...LaneTemplate,
          children: (list as List).children.map((listItem) => {
            return {
              ...ItemTemplate,
              id: generateInstanceId(),
              data: listItemToItemData(md, listItem),
            };
          }),
          id: generateInstanceId(),
          data: {
            title,
            shouldMarkItemsComplete,
          },
        });
      }
    }
  });

  return {
    ...BoardTemplate,
    id: stateManager.file.path,
    children: lanes,
    data: {
      settings,
      frontmatter,
      archive,
      isSearching: false,
      errors: [],
    },
  };
}

export async function updateItemContent(
  stateManager: StateManager,
  oldItem: Item,
  newContent: string
) {
  const md = `- [${oldItem.data.isComplete ? 'x' : ' '}] ${newContent
    .replace(/(\r\n|\n)/g, '<br>')
    .trim()}${oldItem.data.blockId ? ` ^${oldItem.data.blockId}` : ''}`;

  const ast = parseFragment(stateManager, md);

  const itemData = listItemToItemData(
    md,
    (ast.children[0] as List).children[0]
  );

  const newItem = update(oldItem, {
    data: {
      $set: itemData,
    },
  });

  await hydrateItem(stateManager, newItem);

  return newItem;
}

export async function newItem(
  stateManager: StateManager,
  newContent: string,
  isComplete?: boolean
) {
  const md = `- [${isComplete ? 'x' : ' '}] ${newContent
    .trim()
    .replace(/(\r\n|\n)/g, '<br>')}`;

  const ast = parseFragment(stateManager, md);

  const itemData = listItemToItemData(
    md,
    (ast.children[0] as List).children[0]
  );

  const newItem: Item = {
    ...ItemTemplate,
    id: generateInstanceId(),
    data: itemData,
  };

  await hydrateItem(stateManager, newItem);

  return newItem;
}

export async function reparseBoard(stateManager: StateManager, board: Board) {
  return update(board, {
    children: {
      $set: await Promise.all(
        board.children.map(async (lane) => {
          return update(lane, {
            children: {
              $set: await Promise.all(
                lane.children.map(async (item) => {
                  return await updateItemContent(
                    stateManager,
                    item,
                    item.data.titleRaw
                  );
                })
              ),
            },
          });
        })
      ),
    },
  });
}

function itemToMd(item: Item) {
  return `- [${item.data.isComplete ? 'x' : ' '}] ${item.data.titleRaw
    .replace(/(\r\n|\n)/g, '<br>')
    .trim()}${item.data.blockId ? ` ^${item.data.blockId}` : ''}`;
}

function laneToMd(lane: Lane) {
  const lines: string[] = [];

  lines.push(`## ${lane.data.title}`);

  lines.push('');

  if (lane.data.shouldMarkItemsComplete) {
    lines.push(completeString);
  }

  lane.children.forEach((item) => {
    lines.push(itemToMd(item));
  });

  lines.push('');
  lines.push('');
  lines.push('');

  return lines.join('\n');
}

function archiveToMd(archive: Item[]) {
  if (archive.length) {
    const lines: string[] = [archiveString, '', `## ${t('Archive')}`, ''];

    archive.forEach((item) => {
      lines.push(itemToMd(item));
    });

    return lines.join('\n');
  }

  return '';
}

export function boardToMd(board: Board) {
  const lanes = board.children.reduce((md, lane) => {
    return md + laneToMd(lane);
  }, '');

  const frontmatter = [
    '---',
    '',
    stringifyYaml(board.data.frontmatter),
    '---',
    '',
    '',
  ].join('\n');

  return (
    frontmatter +
    lanes +
    archiveToMd(board.data.archive) +
    settingsToCodeblock(board.data.settings)
  );
}
