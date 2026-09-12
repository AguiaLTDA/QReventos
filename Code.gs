/**
 * SISTEMA DE CHECK-IN DE PRESENÇA COM QR CODE DINÂMICO — UNIVC
 * ---------------------------------------------------------------
 * Backend em Google Apps Script. Escreve diretamente numa planilha
 * Google Sheets. Não precisa de servidor externo nem de custo.
 *
 * COMO INSTALAR (resumo — veja LEIA-ME.md para o passo a passo completo):
 * 1. Crie uma planilha Google Sheets nova.
 * 2. Extensões > Apps Script.
 * 3. Cole este arquivo como "Code.gs".
 * 4. Crie 4 arquivos HTML (Admin.html, Display.html, Form.html, QRCode.html)
 *    com o conteúdo fornecido separadamente.
 * 5. Em "Propriedades do Script" (Configurações do projeto), defina
 *    a chave TOKEN_SECRET com um valor aleatório só seu (ex: uma senha longa).
 * 6. Publicar > Implantar como app da web. Executar como "Eu",
 *    Acesso: "Qualquer pessoa" (para os alunos conseguirem abrir o formulário).
 * 7. Use a URL gerada (.../exec) como base do sistema.
 */

// ============ CONFIGURAÇÃO ============
const ABA_EVENTOS = 'Eventos';
const ABA_PRESENCAS = 'Presencas';
const JANELA_TOKEN_SEGUNDOS = 60; // QR muda a cada 60s
const TOLERANCIA_MINUTOS = 1;      // aceita o token do minuto atual e do anterior (evita falha por QR "vencendo" no ato do scan)

// ============ ROTEAMENTO ============

function doGet(e) {
  const page = e.parameter.page || 'admin';

  if (page === 'form') {
    const eventoId = e.parameter.evento || '';
    const token = e.parameter.token || '';
    const template = HtmlService.createTemplateFromFile('Form');
    template.eventoId = eventoId;
    template.token = token;
    template.valido = validarToken_(eventoId, token);
    template.evento = buscarEvento_(eventoId);
    return template.evaluate()
      .setTitle('Confirmar Presença — UNIVC')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  if (page === 'display') {
    const eventoId = e.parameter.evento || '';
    const template = HtmlService.createTemplateFromFile('Display');
    template.eventoId = eventoId;
    template.evento = buscarEvento_(eventoId);
    template.baseUrl = ScriptApp.getService().getUrl();
    return template.evaluate()
      .setTitle('QR Code de Presença — UNIVC')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // padrão: portal administrativo
  const template = HtmlService.createTemplateFromFile('Admin');
  template.baseUrl = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('Portal Administrativo — Presença UNIVC')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============ FUNÇÕES CHAMADAS PELO FRONT (google.script.run) ============

/** Cria um novo evento. Chamado pelo Admin.html */
function criarEvento(dados) {
  const sheet = pegarAba_(ABA_EVENTOS);
  const id = Utilities.getUuid();
  sheet.appendRow([
    id,
    dados.titulo,
    dados.data,
    dados.cargaHoraria,
    new Date()
  ]);
  return { id: id };
}

/** Lista todos os eventos cadastrados. Chamado pelo Admin.html */
function listarEventos() {
  const sheet = pegarAba_(ABA_EVENTOS);
  const linhas = sheet.getDataRange().getValues();
  linhas.shift(); // remove cabeçalho
  return linhas.map(function (l) {
    return { id: l[0], titulo: l[1], data: l[2], cargaHoraria: l[3] };
  }).reverse();
}

/** Retorna o token válido para o minuto atual de um evento. Chamado pelo Display.html a cada minuto */
function gerarTokenAtual(eventoId) {
  return {
    token: gerarToken_(eventoId, Math.floor(Date.now() / 1000)),
    segundosRestantes: JANELA_TOKEN_SEGUNDOS - (Math.floor(Date.now() / 1000) % JANELA_TOKEN_SEGUNDOS)
  };
}

/** Recebe o preenchimento do aluno. Chamado pelo Form.html */
function registrarPresenca(dados) {
  if (!validarToken_(dados.eventoId, dados.token)) {
    return { ok: false, erro: 'QR Code expirado. Peça para escanear o código atualizado na tela.' };
  }

  const evento = buscarEvento_(dados.eventoId);
  if (!evento) {
    return { ok: false, erro: 'Evento não encontrado.' };
  }

  // Evita duplicidade: mesma matrícula + mesmo evento
  const sheet = pegarAba_(ABA_PRESENCAS);
  const linhas = sheet.getDataRange().getValues();
  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i][1] === dados.eventoId && String(linhas[i][6]) === String(dados.matricula)) {
      return { ok: false, erro: 'Presença já registrada para esta matrícula neste evento.' };
    }
  }

  sheet.appendRow([
    new Date(),
    dados.eventoId,
    evento.titulo,
    evento.data,
    evento.cargaHoraria,
    dados.nome,
    dados.matricula,
    dados.cpf,
    dados.curso,
    dados.periodo
  ]);

  return { ok: true };
}

// ============ FUNÇÕES INTERNAS ============

function gerarToken_(eventoId, epochSegundos) {
  const secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET') || 'troque-esta-chave';
  const janela = Math.floor(epochSegundos / JANELA_TOKEN_SEGUNDOS);
  const base = eventoId + ':' + janela + ':' + secret;
  const raw = Utilities.computeHmacSha256Signature(base, secret);
  const hex = raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  return hex.substring(0, 10); // token curto, cabe melhor no QR
}

function validarToken_(eventoId, tokenRecebido) {
  if (!eventoId || !tokenRecebido) return false;
  const agora = Math.floor(Date.now() / 1000);
  for (let m = 0; m <= TOLERANCIA_MINUTOS; m++) {
    const candidato = gerarToken_(eventoId, agora - (m * JANELA_TOKEN_SEGUNDOS));
    if (candidato === tokenRecebido) return true;
  }
  return false;
}

function buscarEvento_(eventoId) {
  const sheet = pegarAba_(ABA_EVENTOS);
  const linhas = sheet.getDataRange().getValues();
  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i][0] === eventoId) {
      return { id: linhas[i][0], titulo: linhas[i][1], data: linhas[i][2], cargaHoraria: linhas[i][3] };
    }
  }
  return null;
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

function include(nomeArquivo) {
  return HtmlService.createHtmlOutputFromFile(nomeArquivo).getContent();
}
