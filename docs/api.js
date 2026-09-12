/**
 * Conversa com a API do Apps Script.
 *
 * Tudo por POST com corpo JSON: a chave administrativa e o CPF do aluno não
 * podem ir em query string, senão ficam gravados em log de servidor e no
 * histórico do navegador.
 *
 * O Content-Type é text/plain de propósito. Com application/json o navegador
 * dispara uma requisição OPTIONS de preflight, que o Apps Script não responde,
 * e a chamada morre em erro de CORS. Com text/plain a requisição é "simples" e
 * passa direto; do lado do servidor o corpo é lido de e.postData.contents e
 * interpretado como JSON do mesmo jeito.
 */

const API_NAO_CONFIGURADA = typeof API_URL === 'undefined'
  || !API_URL
  || API_URL.indexOf('COLE_AQUI') === 0;

async function chamarApi(corpo) {
  if (API_NAO_CONFIGURADA) {
    return { ok: false, erro: 'A URL da API ainda não foi preenchida em docs/config.js.' };
  }

  let resposta;
  try {
    resposta = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo),
      redirect: 'follow' // o Apps Script responde com um 302 para googleusercontent.com
    });
  } catch (err) {
    return {
      ok: false,
      erro: 'Não foi possível falar com o servidor. Verifique a conexão e se a implantação '
        + 'está publicada com acesso "Qualquer pessoa".'
    };
  }

  const texto = await resposta.text();
  try {
    return JSON.parse(texto);
  } catch (err) {
    // Acontece quando a implantação exige login: o Google devolve uma página de HTML.
    return {
      ok: false,
      erro: 'O servidor respondeu algo que não é JSON. A implantação provavelmente está '
        + 'como "Qualquer pessoa com conta Google" em vez de "Qualquer pessoa".'
    };
  }
}

// ---------- chave administrativa ----------

const CHAVE_GUARDADA = 'qreventos.chaveAdmin';

function chaveAdmin() {
  try {
    return localStorage.getItem(CHAVE_GUARDADA) || '';
  } catch (err) {
    return ''; // navegador com armazenamento bloqueado
  }
}

function guardarChaveAdmin(chave) {
  try {
    localStorage.setItem(CHAVE_GUARDADA, chave);
  } catch (err) {
    /* segue sem lembrar entre recarregamentos */
  }
}

function esquecerChaveAdmin() {
  try {
    localStorage.removeItem(CHAVE_GUARDADA);
  } catch (err) {
    /* nada a fazer */
  }
}

/** Chamada administrativa: injeta a chave e trata a expiração de sessão. */
async function chamarComoAdmin(corpo) {
  const resposta = await chamarApi(Object.assign({}, corpo, { chave: chaveAdmin() }));
  if (resposta.semAutorizacao) {
    esquecerChaveAdmin();
  }
  return resposta;
}
