import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGptMakerNewMessage,
  summarizeGptMakerWebhookPayload,
} from './agent-evidence-webhook.js';

const CHAT_ID = '3F58791EFB8AE06F57AAF21652EF4739-554896309676';
const MESSAGE_ID = '3F6CD17E40C530BCB7A09607577B7903';
const IMAGE_URL = 'https://files.example/signed/private-image.jpg?token=secret';

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
