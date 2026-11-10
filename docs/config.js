/**
 * Endereço da API (Apps Script).
 *
 * Cole aqui a URL da implantação, a que termina em /exec. Ela fica visível
 * para qualquer pessoa que abrir o código-fonte da página — e tudo bem: o que
 * protege o sistema é a CHAVE_ADMIN e o token do QR, que ficam no servidor.
 *
 * Onde achar: editor do Apps Script > Implantar > Gerenciar implantações.
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbxblZ6SKMCMSKbd1lOz2VaOPqdzFIk-XvO2xZeD7t3dn-6yVsccei5AVNRzgqDn9FuIbQ/exec';

/**
 * Opções das caixas de seleção do formulário do aluno (presenca.html).
 * Edite à vontade: o que estiver aqui é exatamente o que aparece na lista e
 * o que é gravado na planilha.
 */
const CURSOS = [
  'Administração',
  'Agronomia',
  'Análise e Desenvolvimento de Sistemas',
  'Arquitetura e Urbanismo',
  'Ciências Contábeis',
  'Direito',
  'Educação Física',
  'Enfermagem',
  'Engenharia de Produção',
  'Engenharia Mecânica',
  'Farmácia',
  'Fisioterapia',
  'Medicina Veterinária',
  'Odontologia',
  'Psicologia',
  'Publicidade e Propaganda'
];

const TURMAS = [
  '1º período',
  '2º período',
  '3º período',
  '4º período',
  '5º período',
  '6º período',
  '7º período',
  '8º período',
  '9º período',
  '10º período'
];
