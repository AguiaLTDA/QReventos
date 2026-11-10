# QReventos — Check-in de presença com QR Code dinâmico (UNIVC)

Front-end estático no **GitHub Pages**; o **Google Apps Script** virou API e o
**Google Sheets** é o banco. O Apps Script não serve mais HTML: ele só faz o que
precisa de segredo ou de acesso à planilha.

```
GitHub Pages (docs/)          Apps Script (/exec)          Google Sheets
  index.html    ──┐
  exibir.html   ──┼── POST JSON ──▶  valida token/chave  ──▶  Eventos
  presenca.html ──┘                  grava presença      ──▶  Presencas
```

## Como funciona

- O QR Code não é uma imagem fixa: ele contém um **token** que muda a cada 60 segundos
  (HMAC-SHA256 do evento + janela de minuto atual). Um QR fotografado e repassado deixa
  de funcionar depois de ~2 minutos.
- O aluno escaneia, cai em `presenca.html`, preenche os dados, e a linha vai para a aba
  "Presencas" da planilha.
- Ao abrir o formulário com um QR válido, o aluno recebe uma **sessão** assinada que vale
  15 minutos (`SESSAO_MINUTOS`). É ela que autoriza o envio, então quem escaneia no fim do
  minuto não perde a presença por demorar para digitar.
- Duplicidade (mesmo CPF no mesmo evento) é bloqueada, com `LockService` para que
  duas submissões simultâneas não escapem da checagem. Telefone e CPF são gravados como
  texto, para não perder zeros à esquerda. O CPF é conferido pelo dígito verificador.
- O QR ocupa quase a altura toda da tela e leva um link curto (`?e=<8 primeiros caracteres do
  ID>&t=<token>`), o que deixa cada módulo maior e legível de mais longe.
- A tela do QR tem botão de tela cheia (ou tecla **F**), pede ao navegador para não apagar a
  tela, mostra quantas presenças já foram registradas e apaga o QR se perder a conexão por
  tempo suficiente para o código exibido deixar de valer.

O desenho do QR é feito por um **gerador próprio** (`docs/qrcode.js`), sem CDN e sem
biblioteca externa: num auditório com internet restrita ou com o CDN bloqueado pela rede do
campus, a tela continua funcionando. A saída é SVG, nítido em qualquer tamanho de projeção.

## Arquivos

| Arquivo | Papel |
|---|---|
| `apps-script/Code.gs` | API: token, validação, gravação na planilha |
| `docs/index.html` | Portal administrativo: cadastro e listagem de eventos |
| `docs/exibir.html` | Tela de projeção com o QR |
| `docs/presenca.html` | Formulário do aluno |
| `docs/qrcode.js` | Gerador de QR Code (ISO/IEC 18004), sem dependências |
| `docs/api.js` | Chamadas à API e guarda da chave administrativa |
| `docs/config.js` | **Onde você cola a URL da sua implantação** e edita as listas de cursos e turmas |
| `testes/` | Teste de regressão do gerador de QR Code |

## Instalação

### 1. Backend (Apps Script + Sheets)

1. Crie uma planilha nova em **sheets.google.com**.
2. **Extensões → Apps Script**.
3. Apague o conteúdo padrão e cole `apps-script/Code.gs`. Não é preciso criar arquivo HTML.
4. **Configurações do projeto → Propriedades do script**, adicione duas propriedades:

   | Propriedade | Valor |
   |---|---|
   | `TOKEN_SECRET` | Texto longo e aleatório. É o que torna o QR imprevisível. |
   | `CHAVE_ADMIN` | Senha que libera cadastrar evento e abrir a tela do QR. |

   Gere os valores com `openssl rand -base64 32` e cole direto no painel, sem passar por
   e-mail ou chat. Sem `TOKEN_SECRET` o sistema se recusa a gerar token, de propósito.

5. **Implantar → Nova implantação → App da Web**:
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**

   "Qualquer pessoa **com conta Google**" não serve: quebra o CORS e passa a exigir login
   dos alunos.
6. Copie a URL gerada, a que termina em `/exec`.

### 2. Front-end (GitHub Pages)

1. Cole a URL do passo 6 em `docs/config.js`, em `API_URL`, e faça commit.
2. No GitHub: **Settings → Pages → Source: Deploy from a branch**, branch `main`, pasta
   `/docs`. Salve.
3. O portal fica em `https://<usuario>.github.io/<repositorio>/`.

Ao alterar `apps-script/Code.gs`, publique uma **nova versão** da implantação — salvar no
editor não atualiza a URL `/exec`.

## Uso no dia a dia

1. Abra o portal e informe a chave administrativa (fica guardada neste navegador até você
   clicar em "Sair deste computador").
2. Cadastre o evento: título, data, carga horária.
3. Clique em **"Abrir QR"** — é a tela para projetar no telão. O QR se renova sozinho,
   alinhado com o fim da janela de token do servidor.
4. Os alunos escaneiam, preenchem, e a presença cai na aba "Presencas".

## Estrutura da planilha (criada automaticamente no primeiro uso)

**Aba "Eventos":** ID, Título, Data, Carga Horária, Criado em
**Aba "Presencas":** Timestamp, EventoID, Evento, Data do Evento, Carga Horária, Nome, Telefone, CPF, Curso, Turma

Planilhas criadas antes desta versão mantêm as colunas no lugar: o cabeçalho de G e J vira
"Telefone (antes: Matrícula)" e "Turma (antes: Período)" no primeiro registro novo.

## API

Endpoint único, sempre `POST` com corpo JSON e `Content-Type: text/plain`. O `text/plain`
é proposital: com `application/json` o navegador dispara um preflight `OPTIONS`, que o Apps
Script não responde, e a chamada morre em erro de CORS. Nada vai por query string, para que
a chave administrativa e o CPF não fiquem em log de servidor nem no histórico do navegador.

| Ação | Exige | Retorno |
|---|---|---|
| `listarEventos` | `chave` | `{ ok, eventos[] }` |
| `criarEvento` | `chave`, `titulo`, `data`, `cargaHoraria` | `{ ok, id }` |
| `token` | `chave`, `evento` | `{ ok, token, segundosRestantes }` |
| `eventoAdmin` | `chave`, `evento` | `{ ok, evento }` |
| `contarPresencas` | `chave`, `evento` | `{ ok, total }` |
| `evento` | `evento`, `token` | `{ ok, evento, sessao, sessaoMinutos }` |
| `presenca` | `evento`, `sessao` (ou `token` ainda válido) + dados do aluno | `{ ok }` |

## Testes

O gerador de QR Code é código próprio, então tem teste de regressão. Da raiz do projeto:

```bash
node testes/verificar-qrcode.js
```

Os vetores de `testes/vetores.json` foram conferidos módulo a módulo contra duas
implementações independentes da norma (`segno` e `qrcode`, em Python) e lidos de volta por um
leitor real (OpenCV), cobrindo as versões 1 a 40, os quatro níveis de correção, textos no
limite exato da capacidade e conteúdo acentuado em UTF-8.

## Limitações conhecidas

- **A API é pública por natureza.** A URL `/exec` fica visível no código-fonte do site. O que
  separa equipe de aluno é a `CHAVE_ADMIN`, validada no servidor — troque-a se vazar.
- **A chave fica no `localStorage` do navegador da equipe.** Em computador compartilhado, use
  "Sair deste computador" ao terminar.
- **A validação é temporal, não geográfica.** Quem receber prints do QR em tempo real ainda
  consegue registrar presença de fora do evento.
- **Trocar `TOKEN_SECRET` invalida os QRs em exibição.** Faça fora do horário de um evento.

## Possíveis evoluções

- Exportar relatório de presença por evento em PDF direto da planilha.
- Restringir o formulário por faixa de IP/geolocalização do campus.
- Puxar as listas de curso e turma de uma aba da planilha, em vez de `docs/config.js`.
