/**
 * Teste de regressão do gerador de QR Code (QRCode.html).
 *
 * Não precisa de nenhuma dependência: rode com `node testes/verificar-qrcode.js`
 * a partir da raiz do projeto.
 *
 * Os vetores em `vetores.json` foram conferidos módulo a módulo contra duas
 * implementações independentes da ISO/IEC 18004 (segno e qrcode, ambas em
 * Python) e contra um leitor real (OpenCV). Se este teste falhar depois de uma
 * alteração em QRCode.html, o gerador mudou de comportamento — confira antes de
 * regravar os vetores.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const raiz = path.join(__dirname, '..');

function carregarGerador() {
  const html = fs.readFileSync(path.join(raiz, 'QRCode.html'), 'utf8');
  const js = html
    .replace(/^[\s\S]*?<script>/, '')
    .replace(/<\/script>[\s\S]*$/, '');
  const modulo = { exports: {} };
  new Function('module', js)(modulo);
  return modulo.exports;
}

function impressao(qr) {
  const linhas = qr.modulos.map(function (linha) {
    return linha.map(function (v) { return v ? 1 : 0; }).join('');
  }).join('\n');
  return crypto.createHash('sha256').update(linhas).digest('hex');
}

function main() {
  const QR = carregarGerador();
  const vetores = JSON.parse(fs.readFileSync(path.join(__dirname, 'vetores.json'), 'utf8'));

  let falhas = 0;
  vetores.forEach(function (v, i) {
    const qr = QR.gerar(v.texto, v.nivel, v.mascara);
    const problemas = [];

    if (qr.versao !== v.versao) problemas.push('versão ' + qr.versao + ' (esperada ' + v.versao + ')');
    if (qr.mascara !== v.mascaraEscolhida) problemas.push('máscara ' + qr.mascara + ' (esperada ' + v.mascaraEscolhida + ')');
    if (qr.tamanho !== v.tamanho) problemas.push('tamanho ' + qr.tamanho + ' (esperado ' + v.tamanho + ')');

    const hash = impressao(qr);
    if (hash !== v.sha256) problemas.push('matriz diferente (sha256 ' + hash.slice(0, 12) + '…)');

    if (problemas.length) {
      falhas++;
      console.error('FALHOU [' + i + '] nível ' + v.nivel + ', ' + v.texto.length + ' caracteres: ' + problemas.join('; '));
    }
  });

  // O SVG precisa refletir exatamente a matriz.
  const amostra = QR.gerar('https://exemplo.test/?evento=1&token=abcdef0123', 'M');
  const svg = QR.paraSvg(amostra, { tamanho: 300, margem: 4 });
  const escurosNoSvg = (svg.match(/h1v1h-1z/g) || []).length;
  const escurosNaMatriz = amostra.modulos.reduce(function (total, linha) {
    return total + linha.filter(Boolean).length;
  }, 0);
  if (escurosNoSvg !== escurosNaMatriz) {
    falhas++;
    console.error('FALHOU SVG: ' + escurosNoSvg + ' módulos desenhados para ' + escurosNaMatriz + ' módulos escuros');
  }
  const ladoEsperado = amostra.tamanho + 8;
  if (svg.indexOf('viewBox="0 0 ' + ladoEsperado + ' ' + ladoEsperado + '"') === -1) {
    falhas++;
    console.error('FALHOU SVG: viewBox não corresponde à matriz + zona de silêncio');
  }

  if (falhas) {
    console.error('\n' + falhas + ' verificação(ões) falharam.');
    process.exit(1);
  }
  console.log(vetores.length + ' vetores + 2 verificações de SVG: tudo certo.');
}

main();
