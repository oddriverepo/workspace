import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBrazilPhoneSuffixes,
  buildBrazilPhoneVariants,
  detectImageType,
  extractPhoneFromGptMakerIdentifiers,
  isPrivateAddress,
  mapEvidenceType,
  normalizeEvidencePhone,
  resolveGptMakerImage,
} from './agent-evidence-utils.js';

test('normaliza telefones brasileiros sem duplicar o DDI', () => {
  assert.equal(normalizeEvidencePhone('(11) 99999-9999'), '5511999999999');
  assert.equal(normalizeEvidencePhone('+55 11 99999-9999'), '5511999999999');
  assert.equal(normalizeEvidencePhone('(55) 99999-9999'), '5555999999999');
  assert.equal(normalizeEvidencePhone('+55 55 99999-9999'), '5555999999999');
  assert.equal(normalizeEvidencePhone('554896309676'), '554896309676');
  assert.equal(normalizeEvidencePhone('99999-9999'), '');
  assert.equal(normalizeEvidencePhone('123'), '');
});

test('gera variantes brasileiras com e sem nono digito', () => {
  assert.deepEqual(buildBrazilPhoneVariants('554896309676'), [
    '4896309676',
    '554896309676',
    '48996309676',
    '5548996309676',
  ]);
  assert.deepEqual(buildBrazilPhoneSuffixes('554896309676'), [
    '896309676',
    '996309676',
  ]);
  assert.deepEqual(buildBrazilPhoneVariants('5548996309676'), [
    '48996309676',
    '5548996309676',
    '4896309676',
    '554896309676',
  ]);
});

test('extrai telefone do identificador real de chat do GPT Maker', () => {
  assert.equal(
    extractPhoneFromGptMakerIdentifiers(
      '3F58791EFB8AE06F57AAF21652EF4739-554896309676',
    ),
    '554896309676',
  );
  assert.equal(extractPhoneFromGptMakerIdentifiers('chat-sem-telefone'), '');
});

test('nao inventa variante de nono digito para telefone fixo ou celular invalido', () => {
  assert.deepEqual(buildBrazilPhoneVariants('554832345678'), [
    '4832345678',
    '554832345678',
  ]);
  assert.deepEqual(buildBrazilPhoneVariants('5548951234567'), [
    '48951234567',
    '5548951234567',
  ]);
});

test('mapeia os tipos do agente para os passos usados pela galeria', () => {
  assert.equal(mapEvidenceType('odômetro'), 'odometer-photo');
  assert.equal(mapEvidenceType('lateral esquerda'), 'photo-left');
  assert.equal(mapEvidenceType('lateral_direita'), 'photo-right');
  assert.equal(mapEvidenceType('frontal'), 'photo-front');
  assert.equal(mapEvidenceType('não reconhecido'), 'other');
});

test('detecta formatos de imagem permitidos pela assinatura real', () => {
  assert.deepEqual(
    detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])),
    { mimeType: 'image/jpeg', extension: 'jpg' },
  );
  assert.deepEqual(
    detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    { mimeType: 'image/png', extension: 'png' },
  );
  assert.equal(detectImageType(Buffer.from('isto nao e uma imagem valida')), null);
});

test('bloqueia enderecos locais e privados', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.10.1', '192.168.1.2', '::1', 'fd00::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('localiza a imagem na resposta de fallback do GPT Maker', async () => {
  const previousToken = process.env.GPTMAKER_API_TOKEN;
  process.env.GPTMAKER_API_TOKEN = 'token-de-teste';
  try {
    const result = await resolveGptMakerImage({
      chatId: 'chat-1',
      messageId: 'message-2',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: {
            messages: [
              {
                id: 'message-1',
                role: 'user',
                type: 'IMAGE',
                imageUrl: 'https://files.example/one.jpg',
              },
              {
                id: 'message-2',
                role: 'user',
                type: 'IMAGE',
                media: { url: 'https://files.example/two.jpg' },
                contact: { phone: '(48) 99630-9676' },
                fileName: 'foto.jpg',
                time: 1784049551189,
              },
            ],
          },
        }),
      }),
    });
    assert.deepEqual(result, {
      messageId: 'message-2',
      imageUrl: 'https://files.example/two.jpg',
      phone: '5548996309676',
      fileName: 'foto.jpg',
      messageTime: 1784049551189,
      caption: '',
    });
  } finally {
    if (previousToken === undefined) delete process.env.GPTMAKER_API_TOKEN;
    else process.env.GPTMAKER_API_TOKEN = previousToken;
  }
});

test('aceita lista direta no campo data do GPT Maker', async () => {
  const previousToken = process.env.GPTMAKER_API_TOKEN;
  process.env.GPTMAKER_API_TOKEN = 'token-de-teste';
  try {
    const result = await resolveGptMakerImage({
      chatId: 'chat-2',
      messageId: 'message-3',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [{
            messageId: 'message-3',
            role: 'user',
            type: 'IMAGE',
            image_url: 'https://files.example/three.png',
          }],
        }),
      }),
    });
    assert.equal(result.imageUrl, 'https://files.example/three.png');
    assert.equal(result.phone, '');
  } finally {
    if (previousToken === undefined) delete process.env.GPTMAKER_API_TOKEN;
    else process.env.GPTMAKER_API_TOKEN = previousToken;
  }
});

test('sem messageId seleciona a imagem mais recente enviada pelo usuario', async () => {
  const previousToken = process.env.GPTMAKER_API_TOKEN;
  process.env.GPTMAKER_API_TOKEN = 'token-de-teste';
  try {
    const result = await resolveGptMakerImage({
      chatId: 'chat-3',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          messages: [
            {
              id: 'agent-image',
              role: 'assistant',
              type: 'IMAGE',
              imageUrl: 'https://files.example/agent.jpg',
              time: 300,
            },
            {
              id: 'old-user-image',
              role: 'user',
              type: 'IMAGE',
              imageUrl: 'https://files.example/old.jpg',
              time: 100,
            },
            {
              id: 'new-user-image',
              role: 'user',
              type: 'IMAGE',
              imageUrl: 'https://files.example/new.jpg',
              text: 'traseira',
              time: 200,
            },
          ],
        }),
      }),
    });
    assert.equal(result.messageId, 'new-user-image');
    assert.equal(result.imageUrl, 'https://files.example/new.jpg');
    assert.equal(result.caption, 'traseira');
    assert.equal(result.phone, '');
  } finally {
    if (previousToken === undefined) delete process.env.GPTMAKER_API_TOKEN;
    else process.env.GPTMAKER_API_TOKEN = previousToken;
  }
});
