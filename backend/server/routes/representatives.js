/**
 * Rotas de Representantes (Gerador de Orçamentos)
 * Convertido de CJS para ESM
 */
import { Router } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import * as mongoClient from '../services/mongoClient.js';

function sanitizeText(value = '') {
  return String(value || '').trim().slice(0, 2000);
}

function buildProposalFromRequest(request) {
  const now = new Date().toISOString();
  return {
    id: `rep-${Date.now()}`,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    fonte: 'representante',
    requestStatus: sanitizeText(request.status || 'novo'),
    representante: {
      nome: sanitizeText(request.representanteNome),
      email: sanitizeText(request.representanteEmail),
      telefone: sanitizeText(request.representanteTelefone),
    },
    cliente: {
      nomeAnunciante: sanitizeText(request.anunciante || request.empresa),
      nomeEmpresa: sanitizeText(request.empresa),
      pracas: sanitizeText(request.pracas),
    },
    comercial: {
      numeroCarros: Number(request.numeroCarros) || null,
      tempoCampanhaDias: Number(request.tempoCampanhaDias) || null,
      dataInicio: sanitizeText(request.dataInicio),
      validadeDias: Number(request.validadeDias) || null,
      qtdOrcamentos: 1,
      pagamento: '',
      observacoes: sanitizeText(request.observacoes),
    },
    uploads: {},
    produtosSelecionados: [],
  };
}

export function buildRepresentativesRouter(store) {
  const router = Router();

  router.use(authenticateAdmin);

  router.get('/requests', async (_req, res) => {
    try {
      const list = await mongoClient.listRepresentativeRequests();
      res.json(list);
    } catch (err) {
      console.error('Erro ao listar solicitações:', err);
      res.status(500).json({ error: 'Erro ao listar solicitações' });
    }
  });

  router.get('/requests/:id', async (req, res) => {
    try {
      const found = await mongoClient.getRepresentativeRequestById(req.params.id);
      if (!found) return res.status(404).json({ error: 'Solicitação não encontrada' });
      res.json(found);
    } catch (err) {
      console.error('Erro ao buscar solicitação:', err);
      res.status(500).json({ error: 'Erro ao buscar solicitação' });
    }
  });

  router.post('/requests', async (req, res) => {
    const {
      representanteNome, representanteEmail, representanteTelefone,
      anunciante, empresa, pracas,
      numeroCarros, tempoCampanhaDias, dataInicio, validadeDias, observacoes,
    } = req.body || {};

    if (!representanteNome && !representanteEmail) {
      return res.status(400).json({ error: 'Informe pelo menos seu nome ou e-mail.' });
    }

    try {
      const entry = {
        id: `rep-${Date.now()}`,
        status: 'novo',
        representanteNome: sanitizeText(representanteNome),
        representanteEmail: sanitizeText(representanteEmail),
        representanteTelefone: sanitizeText(representanteTelefone),
        anunciante: sanitizeText(anunciante),
        empresa: sanitizeText(empresa),
        pracas: sanitizeText(pracas),
        numeroCarros: Number(numeroCarros) || null,
        tempoCampanhaDias: Number(tempoCampanhaDias) || null,
        dataInicio: sanitizeText(dataInicio),
        validadeDias: Number(validadeDias) || null,
        observacoes: sanitizeText(observacoes || ''),
      };
      const created = await mongoClient.createRepresentativeRequest(entry);
      res.status(201).json(created);
    } catch (err) {
      console.error('[Representatives] Erro ao criar solicitação:', err);
      if (err.message.includes('MongoDB')) {
        return res.status(503).json({ error: 'Banco de dados temporariamente indisponível.' });
      }
      res.status(500).json({ error: 'Erro ao criar solicitação.' });
    }
  });

  router.patch('/requests/:id/status', async (req, res) => {
    const { status } = req.body || {};
    try {
      const updated = await mongoClient.updateRepresentativeRequestStatus(
        req.params.id,
        sanitizeText(status || 'em_avaliacao'),
      );
      res.json(updated);
    } catch (err) {
      if (err.message === 'Solicitação não encontrada') {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: 'Erro ao atualizar status' });
    }
  });

  router.post('/requests/:id/convert', async (req, res) => {
    try {
      const request = await mongoClient.getRepresentativeRequestById(req.params.id);
      if (!request) return res.status(404).json({ error: 'Solicitação não encontrada' });

      // Criar proposta no MongoDB (não no store JSON)
      const proposalData = buildProposalFromRequest(request);
      const proposal = await mongoClient.createProposal(proposalData);

      // Atualizar solicitação com status "convertida" e ID da proposta
      await mongoClient.updateRepresentativeRequest(req.params.id, {
        status: 'convertida',
        proposalId: proposal.id,
      });

      console.log(`[Representatives] Minuta criada: ${proposal.id} a partir de solicitação ${req.params.id}`);
      res.json({ success: true, proposalId: proposal.id });
    } catch (err) {
      console.error('[Representatives] Erro ao converter solicitação:', err);
      res.status(500).json({ error: 'Erro ao converter solicitação' });
    }
  });

  router.delete('/requests/:id', async (req, res) => {
    try {
      const deleted = await mongoClient.deleteRepresentativeRequest(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Solicitação não encontrada' });
      res.json({ success: true, message: 'Solicitação removida com sucesso' });
    } catch (err) {
      console.error('Erro ao remover solicitação:', err);
      res.status(500).json({ error: 'Erro ao remover solicitação' });
    }
  });

  return router;
}
