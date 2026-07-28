import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAgentEvidence } from './agent-evidence.js';

test('rejeita telefone invalido antes de consultar banco ou Drive', async () => {
  await assert.rejects(
    registerAgentEvidence({
      phone: '123',
      message_id: 'message-1',
      image_url: 'https://files.example/image.jpg',
      media_type: 'IMAGE',
    }),
    (error) => error?.status === 400 && /phone ou chat_id/.test(error.message),
  );
});

test('rejeita eventos que nao representam imagem', async () => {
  await assert.rejects(
    registerAgentEvidence({
      phone: '5511999999999',
      message_id: 'message-2',
      image_url: 'https://files.example/audio.ogg',
      media_type: 'AUDIO',
    }),
    (error) => error?.status === 400 && /media_type=IMAGE/.test(error.message),
  );
});

test('exige URL da imagem ou chat para o fallback do GPT Maker', async () => {
  await assert.rejects(
    registerAgentEvidence({
      phone: '5511999999999',
      message_id: 'message-3',
      media_type: 'IMAGE',
    }),
    (error) => error?.status === 400 && /image_url ou chat_id/.test(error.message),
  );
});
