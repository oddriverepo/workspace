import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskString,
  normalizeGptMakerNewMessage,
  sanitize,
  summarizeGptMakerWebhookPayload,
} from './agent-evidence-webhook.js';

const CHAT_ID = '3F58791EFB8AE06F57AAF21652EF4739-554896309676';
const MESSAGE_ID = '3F6CD17E40C530BCB7A09607577B7903';
const IMAGE_URL = 'https://files.example/signed/private-image.jpg?token=secret';

test('mascara strings longas preservando uma amostra estrutural', () => {
  assert.equal(maskString('12345678'), '12345678');
  assert.equal(
    maskString('1234567890'),
    '1234...[10 chars]...7890',
  );
});

test('sanitiza payload de diagnostico sem expor valores sensiveis', () => {
  const payload = {
    event: 'onNewMessage',
    authorization: 'Bearer segredo-super-secreto',
    phone: '554896309676',
    contact: {
      name: 'Joao',
      id: '3F58791EFB8AE06F57AAF21652EF4739',
    },
    message: {
      role: 'user',
      type: 'IMAGE',
      image: {
        imageUrl: IMAGE_URL,
        mediaType: 'IMAGE',
      },
      text: 'frontal do veiculo enviada pelo motorista',
    },
    items: ['primeiro-item', 'segundo-item', 'terceiro-item', 'quarto-item'],
  };

  const result = sanitize(payload);
  const serialized = JSON.stringify(result);

  assert.equal(result.event, 'onNe...[12 chars]...sage');
  assert.equal(result.authorization, '[REDACTED]');
  assert.equal(result.contact.name, '[REDACTED]');
  assert.equal(result.message.role, 'user');
  assert.equal(result.message.type, 'IMAGE');
  assert.equal(result.message.image.mediaType, 'IMAGE');
  assert.equal(result.items.length, 3);
  assert.equal(serialized.includes('554896309676'), false);
  assert.equal(serialized.includes(IMAGE_URL), false);
  assert.equal(serialized.includes('segredo-super-secreto'), false);
  assert.equal(serialized.includes('3F58791EFB8AE06F57AAF21652EF4739'), false);
  assert.equal(serialized.includes('frontal do veiculo enviada pelo motorista'), false);
  assert.equal(serialized.includes('quarto-item'), false);
});

test('normaliza imagem recebida e extrai telefone do chatId', () => {
  const result = normalizeGptMakerNewMessage({
    event: 'onNewMessage',
    data: {
      chat: { chatId: CHAT_ID },
      message: {
        id: MESSAGE_ID,
        role: 'user',
        type: 'IMAGE',
        text: 'frontal',
        imageUrl: IMAGE_URL,
        time: 1784049551189,
      },
    },
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.input, {
    phone: '554896309676',
    chat_id: CHAT_ID,
    contact_id: '',
    message_id: MESSAGE_ID,
    image_url: IMAGE_URL,
    media_type: 'IMAGE',
    message_time: 1784049551189,
    caption: 'frontal',
    evidence_type: 'frontal',
  });
});

test('normaliza payload real top-level do onNewMessage do GPT Maker', () => {
  const result = normalizeGptMakerNewMessage({
    role: 'user',
    contactPhone: '554896309676',
    contextId: CHAT_ID,
    messageId: MESSAGE_ID,
    images: [IMAGE_URL],
    message: 'frontal',
    channel: 'WHATSAPP',
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.input, {
    phone: '554896309676',
    chat_id: CHAT_ID,
    contact_id: '',
    message_id: MESSAGE_ID,
    image_url: IMAGE_URL,
    media_type: 'IMAGE',
    message_time: null,
    caption: 'frontal',
    evidence_type: 'frontal',
  });
});

test('normaliza payload real com imagem em objeto', () => {
  const result = normalizeGptMakerNewMessage({
    role: 'user',
    contactPhone: '554896309676',
    contextId: CHAT_ID,
    messageId: MESSAGE_ID,
    images: [{ mediaUrl: IMAGE_URL }],
    message: 'lateral esquerda',
    channel: 'WHATSAPP',
  });

  assert.equal(result.accepted, true);
  assert.equal(result.input.image_url, IMAGE_URL);
  assert.equal(result.input.evidence_type, 'lateral esquerda');
});

test('ignora payload real sem imagem', () => {
  const result = normalizeGptMakerNewMessage({
    role: 'user',
    contactPhone: '554896309676',
    contextId: CHAT_ID,
    messageId: MESSAGE_ID,
    images: [],
    message: 'texto sem foto',
    channel: 'WHATSAPP',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'not_image');
});

test('aceita imagem recebida sem imageUrl para fallback pela API', () => {
  const result = normalizeGptMakerNewMessage({
    chatId: CHAT_ID,
    message: {
      messageId: MESSAGE_ID,
      direction: 'incoming',
      mediaType: 'IMAGE',
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.input.image_url, '');
  assert.equal(result.input.phone, '554896309676');
});

test('reconhece ids em objetos chat/contact e sinaliza mensagem recebida', () => {
  const result = normalizeGptMakerNewMessage({
    data: {
      chat: { id: CHAT_ID },
      contact: { id: 'contact-1' },
      message: {
        id: MESSAGE_ID,
        isFromUser: true,
        type: 'IMAGE',
        imageUrl: IMAGE_URL,
      },
    },
  });

  assert.equal(result.accepted, true);
  assert.equal(result.input.chat_id, CHAT_ID);
  assert.equal(result.input.contact_id, 'contact-1');
  assert.equal(result.input.phone, '554896309676');
});

test('ignora imagem enviada pelo proprio agente', () => {
  const result = normalizeGptMakerNewMessage({
    chatId: CHAT_ID,
    message: {
      id: MESSAGE_ID,
      role: 'assistant',
      type: 'IMAGE',
      imageUrl: IMAGE_URL,
    },
  });
  assert.deepEqual(result, {
    accepted: false,
    reason: 'agent_message',
    sender: 'agent',
    type: 'IMAGE',
  });
});

test('ignora mensagem sem remetente confirmado', () => {
  const result = normalizeGptMakerNewMessage({
    chatId: CHAT_ID,
    message: {
      id: MESSAGE_ID,
      type: 'IMAGE',
      imageUrl: IMAGE_URL,
    },
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'sender_not_confirmed');
});

test('resumo de diagnostico nao expoe valores sensiveis', () => {
  const summary = summarizeGptMakerWebhookPayload({
    phone: '554896309676',
    chatId: CHAT_ID,
    message: {
      id: MESSAGE_ID,
      role: 'user',
      type: 'IMAGE',
      imageUrl: IMAGE_URL,
    },
  });
  const serialized = JSON.stringify(summary);

  assert.deepEqual(summary, {
    role: '',
    has_contactPhone: false,
    has_contextId: false,
    has_messageId: false,
    images_count: 0,
    has_chat_id: true,
    has_message_id: true,
    has_contact_id: false,
    has_phone: true,
    has_image_url: true,
    message_type: 'IMAGE',
    message_role: 'user',
  });
  assert.equal(serialized.includes('554896309676'), false);
  assert.equal(serialized.includes(MESSAGE_ID), false);
  assert.equal(serialized.includes(IMAGE_URL), false);
});
