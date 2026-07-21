(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.impactMetrics = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const CONSTANTS = {
    CORRIDAS_POR_DIA: 25,
    PASSAGEIROS_POR_CORRIDA: 1.4,
    KM_POR_MES: 4000,
    DIAS_REFERENCIA_MES: 30,
    IMPACTOS_POR_KM: 30
  };

  const numberFormatter = (typeof Intl !== 'undefined' && Intl.NumberFormat)
    ? new Intl.NumberFormat('pt-BR')
    : { format: (value) => Math.round(value).toString() };

  function formatNumber(value) {
    return numberFormatter.format(Math.round(value || 0));
  }

  function calculateImpactMetrics(diasCampanha, quantidadeCarros) {
    const dias = Math.max(0, Number(diasCampanha) || 0);
    const carros = Math.max(0, Number(quantidadeCarros) || 0);
    if (!dias || !carros) {
      return buildEmptyMetrics(dias, carros);
    }

    const corridas = carros * dias * CONSTANTS.CORRIDAS_POR_DIA;
    const passageirosTransportados = corridas * CONSTANTS.PASSAGEIROS_POR_CORRIDA;
    const kmPorDia = CONSTANTS.KM_POR_MES / CONSTANTS.DIAS_REFERENCIA_MES;
    const kmPercorridos = carros * dias * kmPorDia;
    const impactosPossiveis = kmPercorridos * CONSTANTS.IMPACTOS_POR_KM;

    return {
      corridas,
      corridasFormatado: formatNumber(corridas),
      passageirosTransportados,
      passageirosTransportadosFormatado: formatNumber(passageirosTransportados),
      kmPercorridos,
      kmPercorridosFormatado: formatNumber(kmPercorridos),
      impactosPossiveis,
      impactosPossiveisFormatado: formatNumber(impactosPossiveis),
      parametros: {
        dias,
        carros
      }
    };
  }

  function buildEmptyMetrics(dias, carros) {
    return {
      corridas: 0,
      corridasFormatado: formatNumber(0),
      passageirosTransportados: 0,
      passageirosTransportadosFormatado: formatNumber(0),
      kmPercorridos: 0,
      kmPercorridosFormatado: formatNumber(0),
      impactosPossiveis: 0,
      impactosPossiveisFormatado: formatNumber(0),
      parametros: {
        dias,
        carros
      }
    };
  }

  return {
    calculateImpactMetrics,
    IMPACT_CONSTANTS: CONSTANTS
  };
});
