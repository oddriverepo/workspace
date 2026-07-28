import {
  extractPhoneFromGptMakerIdentifiers,
  normalizeEvidencePhone,
} from './agent-evidence-utils.js';

const MAX_NODES = 200;
const MAX_DEPTH = 6;
const MAX_ID_LENGTH = 200;
const MAX_URL_LENGTH = 4096;
const MAX_TEXT_LENGTH = 1000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectObjects(root) {
  const found = [];
  const queue = [{ value: root, depth: 0, path: 'body' }];
  const visited = new Set();

  while (queue.length && found.length < MAX_NODES) {
    const current = queue.shift();
    if (!isRecord(current.value) || visited.has(current.value)) continue;
    visited.add(current.value);
    found.push(current);
    if (current.depth >= MAX_DEPTH) continue;

    for (const [key, value] of Object.entries(current.value)) {
      if (isRecord(value)) {
        queue.push({ value, depth: current.depth + 1, path: `${current.path}.${key}` });
      } else if (Array.isArray(value)) {
        value.slice(0, 20).forEach((item, index) => {
          if (isRecord(item)) {
            queue.push({
              value: item,
              depth: current.depth + 1,
              path: `${current.path}.${key}[${index}]`,
            });
          }
        });
      }
    }
  }
  return found;
}

function field(object, aliases) {
  if (!isRecord(object)) return undefined;
  const aliasSet = new Set(aliases.map(alias => alias.toLowerCase()));
  for (const [key, value] of Object.entries(object)) {
    if (aliasSet.has(key.toLowerCase()) && value !== undefined && value !== null) return value;
  }
  return undefined;
}

function textValue(value, maxLength = MAX_ID_LENGTH) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength);
}

function imageUrlFrom(object) {
  const direct = textValue(field(object, [
    'imageUrl',
    'image_url',
    'mediaUrl',
    'media_url',
    'fileUrl',
    'file_url',
    'url',
  ]), MAX_URL_LENGTH);
  if (direct.startsWith('https://')) return direct;

  for (const key of ['media', 'file', 'content', 'attachment', 'attachments']) {
    const nested = object?.[key];
    if (isRecord(nested)) {
      const result = imageUrlFrom(nested);
      if (result) return result;
    }
    if (Array.isArray(nested)) {
      for (const item of nested.slice(0, 10)) {
        if (!isRecord(item)) continue;
        const result = imageUrlFrom(item);
        if (result) return result;
      }
    }
  }
  return '';
}

function normalizedType(object) {
  const raw = textValue(field(object, [
    'type',
    'messageType',
    'message_type',
    'mediaType',
    'media_type',
    'contentType',
    'content_type',
  ]), 40).toUpperCase();
  if (raw.includes('IMAGE') || raw === 'PHOTO') return 'IMAGE';
  return raw;
}

function senderKind(object) {
  const role = textValue(field(object, [
    'role',
    'senderRole',
    'sender_role',
    'senderType',
    'sender_type',
    'authorRole',
    'author_role',
    'authorType',
    'author_type',
    'direction',
  ]), 40).toLowerCase();
  const fromMe = field(object, ['fromMe', 'from_me', 'isFromMe', 'is_from_me']);
  const fromUser = field(object, [
    'fromUser',
    'from_user',
    'isFromUser',
    'is_from_user',
    'sentByUser',
    'sent_by_user',
    'isIncoming',
    'is_incoming',
  ]);

  if (fromMe === true || ['assistant', 'agent', 'bot', 'system', 'outbound', 'outgoing'].includes(role)) {
    return 'agent';
  }
  if (
    fromMe === false
    || fromUser === true
    || ['user', 'customer', 'client', 'contact', 'lead', 'inbound', 'incoming'].includes(role)
  ) {
    return 'user';
  }
  return 'unknown';
}

function scoreMessageCandidate(candidate) {
  const object = candidate.value;
  let score = 0;
  if (normalizedType(object) === 'IMAGE') score += 8;
  if (imageUrlFrom(object)) score += 7;
  if (senderKind(object) !== 'unknown') score += 4;
  if (field(object, ['messageId', 'message_id', 'id'])) score += 3;
  if (field(object, ['text', 'caption', 'message', 'body'])) score += 1;
  if (/(message|mensagem|content|payload|data)/i.test(candidate.path)) score += 2;
  return score;
}

function firstAcross(candidates, aliases, maxLength = MAX_ID_LENGTH) {
  for (const candidate of candidates) {
    const value = textValue(field(candidate.value, aliases), maxLength);
    if (value) return value;
  }
  return '';
}

function messageIdentifier(message, candidates) {
  return textValue(field(message, [
    'messageId',
    'message_id',
    'messageUuid',
    'message_uuid',
    'id',
  ])) || firstAcross(candidates, ['messageId', 'message_id', 'messageUuid', 'message_uuid']);
}

function chatIdentifier(message, candidates) {
  const aliases = [
    'chatId',
    'chat_id',
    'conversationId',
    'conversation_id',
    'attendanceId',
    'attendance_id',
  ];
  const direct = textValue(field(message, aliases)) || firstAcross(candidates, aliases);
  if (direct) return direct;
  const chatObject = candidates.find(candidate => /(?:^|\.)(chat|conversation)$/i.test(candidate.path));
  return textValue(field(chatObject?.value, ['id']));
}

function contactIdentifier(message, candidates) {
  const aliases = ['contactId', 'contact_id', 'customerId', 'customer_id'];
  const direct = textValue(field(message, aliases)) || firstAcross(candidates, aliases);
  if (direct) return direct;
  const contactObject = candidates.find(candidate => /(?:^|\.)(contact|customer)$/i.test(candidate.path));
  return textValue(field(contactObject?.value, ['id']));
}

function phoneFromPayload(message, candidates, chatId, contactId) {
  const aliases = [
    'phone',
    'phoneNumber',
    'phone_number',
    'whatsappPhone',
    'whatsapp_phone',
    'contactPhone',
    'contact_phone',
    'senderPhone',
    'sender_phone',
    'remoteJid',
    'remote_jid',
  ];
  const direct = textValue(field(message, aliases), 80) || firstAcross(candidates, aliases, 80);
  return normalizeEvidencePhone(direct)
    || extractPhoneFromGptMakerIdentifiers(chatId, contactId);
}

function messageTimestamp(message, candidates) {
  const aliases = [
    'time',
    'timestamp',
    'messageTime',
    'message_time',
    'createdAt',
    'created_at',
    'sentAt',
    'sent_at',
  ];
  return field(message, aliases) ?? candidates
    .map(candidate => field(candidate.value, aliases))
    .find(value => value !== undefined && value !== null) ?? null;
}

function captionFrom(message) {
  return textValue(field(message, ['caption', 'text', 'message', 'body']), MAX_TEXT_LENGTH);
}

function evidenceTypeFrom(message, candidates, caption) {
  const aliases = ['evidenceType', 'evidence_type'];
  return textValue(field(message, aliases), 80)
    || firstAcross(candidates, aliases, 80)
    || caption
    || 'desconhecido';
}

function readPayload(payload) {
  const candidates = collectObjects(payload);
  const ranked = [...candidates].sort((a, b) =>
    scoreMessageCandidate(b) - scoreMessageCandidate(a),
  );
  const message = ranked[0]?.value || (isRecord(payload) ? payload : {});
  const imageUrl = imageUrlFrom(message)
    || ranked.map(item => imageUrlFrom(item.value)).find(Boolean)
    || '';
  const type = normalizedType(message) || (imageUrl ? 'IMAGE' : '');
  const directSender = senderKind(message);
  const sender = directSender !== 'unknown'
    ? directSender
    : ranked.map(item => senderKind(item.value)).find(kind => kind !== 'unknown') || 'unknown';
  const chatId = chatIdentifier(message, ranked);
  const contactId = contactIdentifier(message, ranked);
  const messageId = messageIdentifier(message, ranked);
  const caption = captionFrom(message);
  const phone = phoneFromPayload(message, ranked, chatId, contactId);

  return {
    ranked,
    message,
    imageUrl,
    type,
    sender,
    chatId,
    contactId,
    messageId,
    caption,
    phone,
  };
}

export function normalizeGptMakerNewMessage(payload = {}) {
  const parsed = readPayload(payload);
  if (parsed.sender === 'agent') {
    return { accepted: false, reason: 'agent_message', sender: parsed.sender, type: parsed.type };
  }
  if (parsed.type !== 'IMAGE') {
    return { accepted: false, reason: 'not_image', sender: parsed.sender, type: parsed.type };
  }
  if (parsed.sender !== 'user') {
    return {
      accepted: false,
      reason: 'sender_not_confirmed',
      sender: parsed.sender,
      type: parsed.type,
    };
  }

  return {
    accepted: true,
    sender: parsed.sender,
    type: parsed.type,
    input: {
      phone: parsed.phone,
      chat_id: parsed.chatId,
      contact_id: parsed.contactId,
      message_id: parsed.messageId,
      image_url: parsed.imageUrl,
      media_type: 'IMAGE',
      message_time: messageTimestamp(parsed.message, parsed.ranked),
      caption: parsed.caption,
      evidence_type: evidenceTypeFrom(parsed.message, parsed.ranked, parsed.caption),
    },
  };
}

export function summarizeGptMakerWebhookPayload(payload = {}) {
  const parsed = readPayload(payload);
  return {
    has_chat_id: Boolean(parsed.chatId),
    has_message_id: Boolean(parsed.messageId),
    has_contact_id: Boolean(parsed.contactId),
    has_phone: Boolean(parsed.phone),
    has_image_url: Boolean(parsed.imageUrl),
    message_type: parsed.type || 'unknown',
    message_role: parsed.sender,
  };
}
