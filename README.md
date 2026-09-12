# QReventos — Check-in de presença com QR Code dinâmico (UNIVC)

Arquitetura: **Google Apps Script** (backend) + **Google Sheets** (armazenamento).
Sem servidor externo, sem custo, tudo dentro da conta Google institucional.

## Como funciona

- O QR Code não é uma imagem fixa: ele contém um **token** que muda a cada 60 segundos
  (calculado por HMAC-SHA256 a partir do evento + janela de minuto atual). Um QR "fotografado"
  e reutilizado depois de ~2 minutos deixa de funcionar — isso impede que um aluno confirme
  presença por outra pessoa fora do horário do evento.
- O aluno escaneia, cai num formulário, preenche os dados e a linha vai direto para a aba
  "Presencas" da planilha.
- Duplicidade (mesma matrícula no mesmo evento) é bloqueada automaticamente.

O desenho do QR é feito por um **gerador próprio embutido** (`QRCode.html`), sem CDN e sem
nenhuma biblioteca externa: num auditório com internet restrita ou com o CDN bloqueado pela
rede do campus, a tela continua funcionando. A saída é SVG, então o código fica nítido em
qualquer tamanho de projeção.

## Arquivos

| Arquivo | Papel |
|---|---|
| `Code.gs` | Backend: roteamento, API do front, geração/validação do token, acesso à planilha |
| `Admin.html` | Portal administrativo: cadastro e listagem de eventos |
| `Display.html` | Tela de projeção: mostra o QR e o renova a cada janela de token |
| `Form.html` | Formulário de confirmação de presença do aluno |
| `QRCode.html` | Gerador de QR Code (ISO/IEC 18004), sem dependências externas |
| `testes/` | Teste de regressão do gerador de QR Code |

## Instalação

1. Crie uma planilha nova em **sheets.google.com**.
2. Vá em **Extensões → Apps Script**.
3. Apague o conteúdo padrão do `Code.gs` e cole o conteúdo do arquivo `Code.gs` deste repositório.
4. No editor do Apps Script, clique no `+` ao lado de "Arquivos" → **HTML** e crie quatro arquivos
   com estes nomes exatos, colando o respectivo conteúdo:
   - `Admin`
   - `Display`
   - `Form`
   - `QRCode`
5. Vá em **Configurações do projeto** (ícone de engrenagem) → **Propriedades do script** →
   adicione uma propriedade `TOKEN_SECRET` com um valor secreto (texto longo, único e aleatório).
   É isso que torna o token imprevisível. **Sem essa propriedade o sistema cai numa chave
   padrão conhecida e qualquer pessoa consegue forjar um token válido.**
6. Clique em **Implantar → Nova implantação**:
   - Tipo: **App da Web**
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa** (necessário para os alunos abrirem o link sem login)
7. Copie a URL gerada (termina em `/exec`). Essa é a URL do **portal administrativo**.

## Uso no dia a dia

- Abra a URL `/exec` → você cai direto no **portal administrativo**.
- Cadastre o evento (título, data, carga horária).
- Na lista de eventos, clique em **"Abrir QR"** → abre a **tela de exibição** (ideal projetar
  num telão ou monitor na entrada do evento). O QR se atualiza sozinho, sempre alinhado com o
  fim da janela de token do servidor.
- Os alunos escaneiam com a câmera do celular, preenchem nome, CPF, matrícula, curso e período,
  e a presença cai automaticamente na aba **"Presencas"** da planilha.

## Estrutura da planilha (criada automaticamente no primeiro uso)

**Aba "Eventos":** ID, Título, Data, Carga Horária, Criado em
**Aba "Presencas":** Timestamp, EventoID, Evento, Data do Evento, Carga Horária, Nome, Matrícula, CPF, Curso, Período

## Testes

O gerador de QR Code é código próprio, então tem teste de regressão. Da raiz do projeto:

```bash
node testes/verificar-qrcode.js
```

Os vetores de `testes/vetores.json` foram conferidos módulo a módulo contra duas implementações
independentes da norma (as bibliotecas `segno` e `qrcode`, em Python) e lidos de volta por um
leitor real (OpenCV), cobrindo as versões 1 a 40, os quatro níveis de correção, textos no limite
exato da capacidade e conteúdo acentuado em UTF-8.

## Limitações conhecidas

- **O portal administrativo não tem autenticação própria.** Como a implantação precisa ficar
  aberta para os alunos, quem tiver a URL `/exec` consegue cadastrar eventos.
- **A validação é temporal, não geográfica.** Quem receber prints do QR em tempo real ainda
  consegue registrar presença de fora do evento.
- **`registrarPresenca` não usa `LockService`**: duas submissões simultâneas da mesma matrícula
  podem escapar da checagem de duplicidade.
- **CPF é aceito como texto livre**, sem validação de dígito verificador.

## Possíveis evoluções

- Exportar relatório de presença por evento em PDF direto da planilha.
- Validar CPF com dígito verificador antes de aceitar.
- Restringir o formulário por faixa de IP/geolocalização do campus.
- Puxar a lista de "Curso" de uma aba de configuração, em vez de fixa no HTML.
