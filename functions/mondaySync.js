const admin = require('firebase-admin');

// Thin wrapper around Monday.com GraphQL API
async function mondayRequest({ token, query, variables = {} }) {
  const resp = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Monday API HTTP ${resp.status}: ${text}`);
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Monday API parse error: ${text}`); }
  if (json.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

function mapStatusToMonday(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'done' || s === 'complete' || s === '4') return 'Done';
  if (s === 'active' || s === 'in-progress' || s === '2') return 'Working on it';
  if (s === 'planned' || s === '0' || s === '1') return 'Planned';
  return 'Stuck';
}

function mapStatusToBob(mondayStatus) {
  const s = String(mondayStatus || '').toLowerCase();
  if (s.includes('done')) return 'done';
  if (s.includes('working')) return 'in-progress';
  if (s.includes('planned')) return 'planned';
  return 'backlog';
}

function extractAssignees(event) {
  try {
    const raw = event.value;
    if (!raw) return [];
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.personsAndTeams) {
        return (parsed.personsAndTeams || []).map((p) => p.id).filter(Boolean);
      }
    }
    if (typeof raw === 'object' && raw.personsAndTeams) {
      return (raw.personsAndTeams || []).map((p) => p.id).filter(Boolean);
    }
  } catch {
    return [];
  }
  return [];
}

async function ensureBoardForGoal({ token, goalDoc, goalId }) {
  if (goalDoc.mondayBoardId && goalDoc.mondayGroupId) {
    return { boardId: goalDoc.mondayBoardId, groupId: goalDoc.mondayGroupId };
  }
  const boardName = goalDoc.title || goalId;
  const data = await mondayRequest({
    token,
    query: `
      mutation CreateBoard($boardName: String!) {
        create_board(board_name: $boardName, board_kind: private) { id }
      }
    `,
    variables: { boardName },
  });
  const boardId = data?.create_board?.id;
  if (!boardId) throw new Error('Failed to create Monday board');

  const groupRes = await mondayRequest({
    token,
    query: `
      mutation CreateGroup($boardId: Int!, $groupName: String!) {
        create_group(board_id: $boardId, group_name: $groupName) { id }
      }
    `,
    variables: { boardId: Number(boardId), groupName: 'Stories' },
  });
  const groupId = groupRes?.create_group?.id;
  if (!groupId) throw new Error('Failed to create Monday group');

  await admin.firestore().collection('goals').doc(goalId).set({
    mondayBoardId: boardId,
    mondayGroupId: groupId,
    mondayLinkedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { boardId, groupId };
}

async function upsertMondayItemForStory({ token, storyDoc, storyId, goalDoc, goalId }) {
  if (!goalDoc?.mondayBoardId) return null;
  const boardId = Number(goalDoc.mondayBoardId);
  const groupId = goalDoc.mondayGroupId;
  const title = storyDoc.title || storyId;
  const statusLabel = mapStatusToMonday(storyDoc.status);
  const ref = storyDoc.ref || storyId;
  const mondayUrlFor = (id) => `https://view.monday.com/boards/${boardId}/pulses/${id}`;

  const existingItemId = storyDoc.mondayItemId ? Number(storyDoc.mondayItemId) : null;
  if (!existingItemId) {
    // create item
    const res = await mondayRequest({
      token,
      query: `
        mutation CreateItem($boardId: Int!, $groupId: String!, $itemName: String!, $ref: String!) {
          create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: "{\"text\": \"$ref\"}") { id }
        }
      `,
      variables: { boardId, groupId, itemName: title, ref },
    });
    const itemId = res?.create_item?.id;
    if (itemId) {
      await admin.firestore().collection('stories').doc(storyId).set({
        mondayItemId: itemId,
        mondayBoardId: goalDoc.mondayBoardId,
        mondayGroupId: groupId,
        mondayUrl: mondayUrlFor(itemId),
      }, { merge: true });
      await mondayRequest({
        token,
        query: `
          mutation UpdateStatus($boardId: Int!, $itemId: Int!, $status: String!) {
            change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "status", value: $status) { id }
          }
        `,
        variables: { boardId, itemId: Number(itemId), status: statusLabel },
      });
    }
    return itemId;
  } else {
    // update existing item
    await mondayRequest({
      token,
      query: `
        mutation UpdateItem($boardId: Int!, $itemId: Int!, $name: String!, $status: String!) {
          change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: "{\"name\":\"$name\", \"status\":\"$status\"}") { id }
        }
      `,
      variables: { boardId, itemId: existingItemId, name: title, status: statusLabel },
    });
    return existingItemId;
  }
}

module.exports = {
  mondayRequest,
  ensureBoardForGoal,
  upsertMondayItemForStory,
  mapStatusToMonday,
  mapStatusToBob,
  extractAssignees,
};
