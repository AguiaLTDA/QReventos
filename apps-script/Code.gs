/**
 * QReventos — API de check-in de presença (UNIVC)
 * ---------------------------------------------------------------
 * Este script NÃO serve mais HTML. O front-end é estático e mora no
 * GitHub Pages; aqui ficam só as coisas que precisam de segredo ou de
 * acesso à planilha: gerar/validar token e gravar na aba "Presencas".
 *
 * Todas as chamadas chegam por POST com corpo JSON, num único endpoint.
 * Motivo de não usar GET: a chave administrativa e o CPF do aluno não
 * podem viajar em query string (ficam em log de servidor e no histórico
 * do navegador).
 *
 * INSTALAÇÃO
 * 1. Crie uma planilha Google Sheets nova.
 * 2. Extensões > Apps Script.
 * 3. Cole este arquivo como "Code.gs". Não é preciso criar nenhum arquivo HTML.
 * 4. Configurações do projeto > Propriedades do script, adicione DUAS propriedades:
 *      TOKEN_SECRET  — texto longo e aleatório; é o que torna o QR imprevisível.
 *      CHAVE_ADMIN   — senha que libera cadastrar evento e abrir a tela do QR.
 *    Sem TOKEN_SECRET o sistema se recusa a gerar token, de propósito.
 * 5. Implantar > Nova implantação > Tipo "App da Web".
 *      Executar como:      Eu
 *      Quem tem acesso:    Qualquer pessoa
 *    "Qualquer pessoa com conta Google" NÃO serve: quebra o CORS e os alunos
 *    passam a precisar de login.
 * 6. Copie a URL gerada (termina em /exec) e cole em docs/config.js.
 *
 * Toda vez que alterar este arquivo é preciso publicar uma NOVA VERSÃO da
 * implantação — salvar no editor não atualiza a URL /exec.
 */

// ============ CONFIGURAÇÃO ============
const ABA_EVENTOS = 'Eventos';
const ABA_PRESENCAS = 'Presencas';
const JANELA_TOKEN_SEGUNDOS = 60; // QR muda a cada 60s
const TOLERANCIA_MINUTOS = 1;     // aceita o token do minuto atual e do anterior
const CAMPOS_PRESENCA = ['nome', 'matricula', 'cpf', 'curso', 'periodo'];

// ============ ROTEAMENTO HTTP ============

/** Só existe para dar um retorno legível a quem abrir a URL no navegador. */
function doGet() {
  return responder_({
    ok: true,
    servico: 'QReventos',
    aviso: 'API ativa. As operações são feitas por POST com corpo JSON.'
  });
}

function doPost(e) {
  let corpo;
  try {
    corpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return responder_({ ok: false, erro: 'Corpo da requisição não é JSON válido.' });
  }

  try {
    return responder_(executar_(corpo));
  } catch (err) {
    return responder_({ ok: false, erro: err.message });
  }
}

function executar_(dados) {
  switch (dados.acao) {
    // Operações da equipe — exigem a chave administrativa
    case 'listarEventos':
      return comAdmin_(dados, function () { return { ok: true, eventos: listarEventos_() }; });
    case 'criarEvento':
      return comAdmin_(dados, function () { return criarEvento_(dados); });
    case 'token':
      return comAdmin_(dados, function () { return tokenAtual_(dados.evento); });

    // Operações do aluno — o próprio token do QR é a credencial
    case 'evento':
      return dadosDoEvento_(dados.evento, dados.token);
    case 'presenca':
      return registrarPresenca_(dados);

    default:
      return { ok: false, erro: 'Ação desconhecida: ' + dados.acao };
  }
}

function responder_(objeto) {
  // O Apps Script já devolve Access-Control-Allow-Origin: * neste tipo de
  // resposta, que é o que permite a página do GitHub Pages ler o retorno.
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ AUTENTICAÇÃO DA EQUIPE ============

function comAdmin_(dados, acao) {
  const esperada = PropertiesService.getScriptProperties().getProperty('CHAVE_ADMIN');
  if (!esperada) {
    return { ok: false, erro: 'CHAVE_ADMIN não configurada nas propriedades do script.' };
  }
  if (!iguaisEmTempoConstante_(String(dados.chave || ''), esperada)) {
    return { ok: false, erro: 'Chave administrativa inválida.', semAutorizacao: true };
  }
  return acao();
}

/**
 * Compara pelo digest, para que o tempo de resposta não varie conforme o
 * quanto do começo da chave o atacante acertou.
 */
function iguaisEmTempoConstante_(a, b) {
  const da = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a, Utilities.Charset.UTF_8);
  const db = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b, Utilities.Charset.UTF_8);
  let diferenca = 0;
  for (let i = 0; i < da.length; i++) diferenca |= da[i] ^ db[i];
  return diferenca === 0;
}

// ============ EVENTOS ============

function criarEvento_(dados) {
  const titulo = String(dados.titulo || '').trim();
  const data = String(dados.data || '').trim();
  const cargaHoraria = String(dados.cargaHoraria || '').trim();
  if (!titulo || !data || !cargaHoraria) {
    return { ok: false, erro: 'Informe título, data e carga horária.' };
  }

  const sheet = pegarAba_(ABA_EVENTOS);
  const id = Utilities.getUuid();
  sheet.appendRow([id, titulo, data, cargaHoraria, new Date()]);
  return { ok: true, id: id };
}

function listarEventos_() {
  const sheet = pegarAba_(ABA_EVENTOS);
  const linhas = sheet.getDataRange().getValues();
  linhas.shift(); // remove cabeçalho
  return linhas.map(function (l) {
    return { id: l[0], titulo: l[1], data: formatarData_(l[2]), cargaHoraria: l[3] };
  }).reverse();
}

/** Dados mínimos para o aluno saber o que está confirmando. Exige token válido. */
function dadosDoEvento_(eventoId, token) {
  if (!validarToken_(eventoId, token)) {
    return { ok: false, erro: 'QR Code expirado. Escaneie o código atual na tela do evento.', expirado: true };
  }
  const evento = buscarEvento_(eventoId);
  if (!evento) return { ok: false, erro: 'Evento não encontrado.' };
  return { ok: true, evento: evento };
}

// ============ PRESENÇA ============

function registrarPresenca_(dados) {
  if (!validarToken_(dados.evento, dados.token)) {
    return { ok: false, erro: 'QR Code expirado. Peça para escanear o código atualizado na tela.', expirado: true };
  }

  const evento = buscarEvento_(dados.evento);
  if (!evento) return { ok: false, erro: 'Evento não encontrado.' };

  const faltando = CAMPOS_PRESENCA.filter(function (campo) {
    return !String(dados[campo] || '').trim();
  });
  if (faltando.length) return { ok: false, erro: 'Preencha todos os campos.' };

  // Sem o lock, duas submissões simultâneas da mesma matrícula passam as duas
  // pela checagem de duplicidade antes de qualquer uma gravar.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, erro: 'Sistema ocupado no momento. Tente de novo em alguns segundos.' };
  }

  try {
    const sheet = pegarAba_(ABA_PRESENCAS);
    const linhas = sheet.getDataRange().getValues();
    for (let i = 1; i < linhas.length; i++) {
      if (linhas[i][1] === dados.evento && String(linhas[i][6]) === String(dados.matricula)) {
        return { ok: false, erro: 'Presença já registrada para esta matrícula neste evento.' };
      }
    }

    sheet.appendRow([
      new Date(),
      dados.evento,
      evento.titulo,
      evento.data,
      evento.cargaHoraria,
      String(dados.nome).trim(),
      String(dados.matricula).trim(),
      String(dados.cpf).trim(),
      String(dados.curso).trim(),
      String(dados.periodo).trim()
    ]);
  } finally {
    lock.releaseLock();
  }

  return { ok: true };
}

// ============ TOKEN ============

function tokenAtual_(eventoId) {
  if (!buscarEvento_(eventoId)) return { ok: false, erro: 'Evento não encontrado.' };
  const agora = Math.floor(Date.now() / 1000);
  return {
    ok: true,
    token: gerarToken_(eventoId, agora),
    segundosRestantes: JANELA_TOKEN_SEGUNDOS - (agora % JANELA_TOKEN_SEGUNDOS)
  };
}

function gerarToken_(eventoId, epochSegundos) {
  const secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!secret) {
    // Antes existia uma chave padrão aqui. Como este arquivo é público, isso
    // equivalia a não ter segredo nenhum: melhor falhar do que fingir proteger.
    throw new Error('TOKEN_SECRET não configurado nas propriedades do script.');
  }
  const janela = Math.floor(epochSegundos / JANELA_TOKEN_SEGUNDOS);
  const base = eventoId + ':' + janela;
  const raw = Utilities.computeHmacSha256Signature(base, secret);
  const hex = raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  return hex.substring(0, 10); // token curto, cabe melhor no QR
}

function validarToken_(eventoId, tokenRecebido) {
  if (!eventoId || !tokenRecebido) return false;
  const agora = Math.floor(Date.now() / 1000);
  for (let m = 0; m <= TOLERANCIA_MINUTOS; m++) {
    if (gerarToken_(eventoId, agora - (m * JANELA_TOKEN_SEGUNDOS)) === tokenRecebido) return true;
  }
  return false;
}

// ============ PLANILHA ============

function buscarEvento_(eventoId) {
  const sheet = pegarAba_(ABA_EVENTOS);
  const linhas = sheet.getDataRange().getValues();
  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i][0] === eventoId) {
      return {
        id: linhas[i][0],
        titulo: linhas[i][1],
        data: formatarData_(linhas[i][2]),
        cargaHoraria: linhas[i][3]
      };
    }
  }
  return null;
}

/** A planilha devolve Date quando a célula é reconhecida como data; o JSON precisa de texto. */
function formatarData_(valor) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(valor);
}

function pegarAba_(nome) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(nome);
  if (!sheet) {
    sheet = ss.insertSheet(nome);
    if (nome === ABA_EVENTOS) {
      sheet.appendRow(['ID', 'Título', 'Data', 'Carga Horária', 'Criado em']);
    } else if (nome === ABA_PRESENCAS) {
      sheet.appendRow(['Timestamp', 'EventoID', 'Evento', 'Data do Evento', 'Carga Horária', 'Nome', 'Matrícula', 'CPF', 'Curso', 'Período']);
    }
  }
  return sheet;
}
