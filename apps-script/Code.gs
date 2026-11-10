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
const SESSAO_MINUTOS = 15;        // tempo que o aluno tem para enviar o formulário depois de escanear
const CAMPOS_PRESENCA = ['nome', 'telefone', 'cpf', 'curso', 'turma'];

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
    case 'eventoAdmin':
      return comAdmin_(dados, function () {
        const evento = buscarEvento_(dados.evento);
        return evento ? { ok: true, evento: evento } : { ok: false, erro: 'Evento não encontrado.' };
      });
    case 'contarPresencas':
      return comAdmin_(dados, function () { return { ok: true, total: contarPresencas_(dados.evento) }; });

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

/**
 * Dados mínimos para o aluno saber o que está confirmando. Exige token válido.
 * O QR leva só o começo do ID do evento (link mais curto = QR com menos
 * módulos, mais fácil de ler de longe); a resposta devolve o ID completo.
 */
function dadosDoEvento_(eventoId, token) {
  const evento = buscarEvento_(eventoId);
  if (!evento || !validarToken_(evento.id, token)) {
    return { ok: false, erro: 'QR Code expirado. Escaneie o código atual na tela do evento.', expirado: true };
  }
  // O token do QR vence em 1 a 2 minutos. A sessão dá ao aluno tempo de
  // preencher o formulário com calma depois de ter escaneado um QR válido.
  return { ok: true, evento: evento, sessao: gerarSessao_(evento.id), sessaoMinutos: SESSAO_MINUTOS };
}

function contarPresencas_(eventoId) {
  const sheet = pegarAba_(ABA_PRESENCAS);
  const quantidade = sheet.getLastRow() - 1;
  if (quantidade <= 0) return 0;
  const ids = sheet.getRange(2, 2, quantidade, 1).getValues(); // só a coluna EventoID
  let total = 0;
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === eventoId) total++;
  return total;
}

// ============ PRESENÇA ============

function registrarPresenca_(dados) {
  const evento = buscarEvento_(dados.evento);
  // A sessão é a credencial normal. O token do QR continua aceito para
  // formulários abertos antes desta versão (que não recebiam sessão).
  if (!evento || (!validarSessao_(evento.id, dados.sessao) && !validarToken_(evento.id, dados.token))) {
    return {
      ok: false,
      erro: 'O tempo para enviar o formulário acabou. Escaneie o QR Code atual na tela do evento.',
      expirado: true
    };
  }

  const faltando = CAMPOS_PRESENCA.filter(function (campo) {
    return !String(dados[campo] || '').trim();
  });
  if (faltando.length) return { ok: false, erro: 'Preencha todos os campos.' };

  const cpf = soDigitos_(dados.cpf);
  if (!cpfValido_(cpf)) return { ok: false, erro: 'CPF inválido. Confira os números digitados.' };
  const telefone = soDigitos_(dados.telefone);
  if (telefone.length < 10 || telefone.length > 11) {
    return { ok: false, erro: 'Telefone inválido. Informe o DDD e o número.' };
  }

  // Sem o lock, duas submissões simultâneas do mesmo CPF passam as duas
  // pela checagem de duplicidade antes de qualquer uma gravar.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { ok: false, erro: 'Sistema ocupado no momento. Tente de novo em alguns segundos.' };
  }

  try {
    const sheet = pegarAba_(ABA_PRESENCAS);
    atualizarCabecalhoPresencas_(sheet);
    const linhas = sheet.getDataRange().getValues();
    for (let i = 1; i < linhas.length; i++) {
      if (linhas[i][1] === evento.id && chaveCpf_(linhas[i][7]) === cpf) {
        return { ok: false, erro: 'Presença já registrada para este CPF neste evento.' };
      }
    }

    // appendRow converte "01234567890" no número 1234567890, e o zero à
    // esquerda some. Formatando a linha como texto antes de gravar, o valor
    // fica exatamente como deve ser.
    const proxima = sheet.getLastRow() + 1;
    // Diferente de appendRow, getRange não cria linhas: a aba nasce com 1000.
    if (proxima > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
    const destino = sheet.getRange(proxima, 1, 1, 10);
    destino.offset(0, 6, 1, 2).setNumberFormat('@'); // Telefone e CPF
    destino.setValues([[
      new Date(),
      evento.id,
      evento.titulo,
      evento.data,
      evento.cargaHoraria,
      String(dados.nome).trim(),
      formatarTelefone_(telefone),
      formatarCpf_(cpf),
      String(dados.curso).trim(),
      String(dados.turma).trim()
    ]]);
    SpreadsheetApp.flush(); // grava antes de soltar o lock, para a próxima checagem já enxergar esta linha
  } finally {
    lock.releaseLock();
  }

  return { ok: true };
}

/**
 * Planilhas criadas antes desta versão têm "Matrícula" e "Período" nas colunas
 * G e J. As colunas continuam no mesmo lugar (as linhas antigas não se
 * misturam), só o cabeçalho passa a dizer o que as linhas novas guardam.
 */
function atualizarCabecalhoPresencas_(sheet) {
  if (sheet.getRange('G1').getValue() === 'Matrícula') {
    sheet.getRange('G1').setValue('Telefone (antes: Matrícula)');
    sheet.getRange('J1').setValue('Turma (antes: Período)');
  }
}

function soDigitos_(valor) {
  return String(valor || '').replace(/\D/g, '');
}

/** CPF só com dígitos, com os zeros à esquerda que a planilha possa ter comido. */
function chaveCpf_(valor) {
  const d = soDigitos_(valor);
  return d ? ('00000000000' + d).slice(-11) : '';
}

function cpfValido_(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
    if ((soma * 10) % 11 % 10 !== Number(d[t])) return false;
  }
  return true;
}

function formatarCpf_(d) {
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

function formatarTelefone_(d) {
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length - 4) + '-' + d.slice(-4);
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
  const janela = Math.floor(epochSegundos / JANELA_TOKEN_SEGUNDOS);
  return assinar_(eventoId + ':' + janela, 10); // token curto, cabe melhor no QR
}

/** HMAC-SHA256 com o TOKEN_SECRET, em hexadecimal, cortado em `tamanho` caracteres. */
function assinar_(base, tamanho) {
  const secret = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!secret) {
    // Antes existia uma chave padrão aqui. Como este arquivo é público, isso
    // equivalia a não ter segredo nenhum: melhor falhar do que fingir proteger.
    throw new Error('TOKEN_SECRET não configurado nas propriedades do script.');
  }
  const raw = Utilities.computeHmacSha256Signature(base, secret);
  const hex = raw.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  return hex.substring(0, tamanho);
}

/**
 * Sessão do formulário: "<expira em epoch>.<assinatura>". Só é emitida a quem
 * apresentou um token de QR válido, e vale SESSAO_MINUTOS a partir daí.
 * O prefixo "sessao:" impede que uma sessão seja confundida com token de QR.
 */
function gerarSessao_(eventoId) {
  const expira = Math.floor(Date.now() / 1000) + SESSAO_MINUTOS * 60;
  return expira + '.' + assinar_('sessao:' + eventoId + ':' + expira, 32);
}

function validarSessao_(eventoId, sessao) {
  if (!eventoId || !sessao) return false;
  const partes = String(sessao).split('.');
  if (partes.length !== 2 || !/^\d+$/.test(partes[0])) return false;
  if (Number(partes[0]) < Math.floor(Date.now() / 1000)) return false;
  const esperada = assinar_('sessao:' + eventoId + ':' + partes[0], 32);
  return iguaisEmTempoConstante_(partes[1], esperada);
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
    // Aceita o ID completo ou só o começo dele (ao menos 8 caracteres), que é
    // o que vai no QR para deixar o link curto.
    const id = String(linhas[i][0]);
    if (id === eventoId || (String(eventoId).length >= 8 && id.indexOf(eventoId) === 0)) {
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
      sheet.appendRow(['Timestamp', 'EventoID', 'Evento', 'Data do Evento', 'Carga Horária', 'Nome', 'Telefone', 'CPF', 'Curso', 'Turma']);
      sheet.getRange('G:H').setNumberFormat('@'); // Telefone e CPF como texto
    }
  }
  return sheet;
}
