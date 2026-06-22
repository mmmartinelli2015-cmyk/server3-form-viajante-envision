import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const PORT = process.env.PORT || 3002;

// ======================= ENV =======================
const RD_CRM_API_TOKEN = process.env.RD_CRM_API_TOKEN;

const ENVISION_BASE_URL                        = process.env.ENVISION_BASE_URL || 'https://api.travelagent.com.br';
const ENVISION_USERNAME                        = process.env.ENVISION_USERNAME;
const ENVISION_PASSWORD                        = process.env.ENVISION_PASSWORD;
const ENVISION_FORM_ENDPOINT                   = process.env.ENVISION_FORM_ENDPOINT || '/Records';
const ENVISION_CONSOLIDATOR_ID                 = Number(process.env.ENVISION_CONSOLIDATOR_ID || 0);
const ENVISION_CONSOLIDATOR_SYSTEM_ACCOUNT_ID  = Number(process.env.ENVISION_CONSOLIDATOR_SYSTEM_ACCOUNT_ID || 0);
const ENVISION_TRAVEL_AGENCY_ID                = Number(process.env.ENVISION_TRAVEL_AGENCY_ID || 0);
const ENVISION_TRAVEL_AGENCY_SYSTEM_ACCOUNT_ID = Number(process.env.ENVISION_TRAVEL_AGENCY_SYSTEM_ACCOUNT_ID || 0);
const ENVISION_SYSTEM_ACCOUNT_ID               = Number(process.env.ENVISION_SYSTEM_ACCOUNT_ID || 0);
const ENVISION_RECORD_TYPE                     = process.env.ENVISION_RECORD_TYPE || 'Person';

// ======================= RECORDS MAP =======================
const RECORDS_MAP_FILE = 'C:/Users/Migue/Desktop/records-map.json';

function loadRecordsMap() {
  try {
    if (fs.existsSync(RECORDS_MAP_FILE)) {
      return JSON.parse(fs.readFileSync(RECORDS_MAP_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[RecordsMap] Erro ao carregar:', err.message);
  }
  return {};
}

function findRecordIdInMap(cpf, email) {
  const map = loadRecordsMap();

  if (cpf) {
    const id = map[cpf] || map[cpf.replace(/\D/g, '')];
    if (id) return id;
  }

  if (email) {
    const id = map[email.toLowerCase()];
    if (id) return id;
  }

  return null;
}

console.log('Token CRM legado carregado?', !!RD_CRM_API_TOKEN);
console.log('Envision BASE_URL carregado?', !!ENVISION_BASE_URL);
console.log('Envision username carregado?', !!ENVISION_USERNAME);
console.log('Envision password carregado?', !!ENVISION_PASSWORD);
console.log('Envision endpoint formulario:', ENVISION_FORM_ENDPOINT);

// ======================= HELPERS =======================
function onlyDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function safeString(value = '') {
  return String(value ?? '').trim();
}

function boolToSimNao(value) {
  return value ? 'sim' : 'nao';
}

function boolToBoolean(value) {
  if (typeof value === 'boolean') return value;
  const v = safeString(value).toLowerCase();
  return ['true', '1', 'sim', 'yes', 'on'].includes(v);
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === false) return value;
    if (value === 0) return value;
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function removeEmptyDeep(obj) {
  if (Array.isArray(obj)) {
    return obj
      .map(removeEmptyDeep)
      .filter(
        (item) =>
          item !== '' &&
          item !== null &&
          item !== undefined &&
          !(typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0)
      );
  }

  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleaned = removeEmptyDeep(value);
      const isEmptyObject =
        cleaned &&
        typeof cleaned === 'object' &&
        !Array.isArray(cleaned) &&
        Object.keys(cleaned).length === 0;

      if (cleaned === '' || cleaned === null || cleaned === undefined || isEmptyObject) continue;
      out[key] = cleaned;
    }
    return out;
  }

  return obj;
}

function parseDateParts(value = '') {
  const v = safeString(value);
  if (!v) return undefined;

  let year, month, day;

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    [year, month, day] = v.split('-').map(Number);
  } else {
    const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!br) return undefined;
    day = Number(br[1]);
    month = Number(br[2]);
    year = Number(br[3]);
  }

  if (!year || !month || !day) return undefined;
  return { year, month, day };
}

function getDayOfWeekName(year, month, day) {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return names[new Date(year, month - 1, day).getDay()];
}

function buildExpireDate(value = '') {
  const date = parseDateParts(value);
  if (!date) return undefined;

  return {
    ...date,
    dayOfWeek: getDayOfWeekName(date.year, date.month, date.day),
    hour: 0,
    minutes: 0,
    seconds: 0,
    millisecond: 0
  };
}

function parseGridItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch {
      return [];
    }
  }

  if (typeof value === 'object') return [value];
  return [];
}

function normalizeGender(value = '') {
  const v = safeString(value).toLowerCase();
  if (['masculino', 'male', 'm', '0'].includes(v)) return { gender: '0', genderName: 'Masculino' };
  if (['feminino', 'female', 'f', '1'].includes(v)) return { gender: '1', genderName: 'Feminino' };
  return { gender: '0', genderName: 'Masculino' };
}

function splitName(fullName = '') {
  const parts = safeString(fullName).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    middleName: '',
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : ''
  };
}

function normalizeCustomFields(input) {
  if (!input) return {};

  if (Array.isArray(input)) {
    const out = {};
    for (const item of input) {
      const key = safeString(
        item?.custom_field_api_identifier ||
        item?.custom_field_id ||
        item?.name ||
        item?.key
      );
      if (key) out[key] = item?.value;
    }
    return out;
  }

  if (typeof input === 'object') return input;
  return {};
}

function addAliases(target, aliases, value) {
  if (value === '' || value === null || value === undefined) return;
  for (const key of aliases) target[key] = value;
}

// ======================= PREFERENCIA DE CONTATO =======================
// Travel Agent: 1=WhatsApp, 2=Email, 3=Telefone
function normalizePreferredContact(value = '') {
  const v = safeString(value).toLowerCase();
  if (['whatsapp', 'whats'].includes(v)) return '1';
  if (['email', 'e-mail'].includes(v)) return '2';
  if (['telefone', 'phone', 'tel'].includes(v)) return '3';
  return '2';
}

// ======================= ALERGIAS =======================
function buildAllergies(formData) {
  const allergies = [];

  const parsed = parseGridItems(
    pickFirst(
      formData.allergies,
      formData.Allergies,
      formData.gridAllergies,
      formData['Person.Allergy'],
      formData['person.Allergy'],
      formData.Allergy,
      formData.allergy
    )
  );

  for (const item of parsed) {
    const normalized = removeEmptyDeep({
      Name: safeString(item?.Name || item?.name || item?.nome),
      Description: safeString(item?.Description || item?.description || item?.descricao || item?.obs)
    });
    if (Object.keys(normalized).length) allergies.push(normalized);
  }

  const textoAlergia = safeString(formData.alergiasTexto);
  const possuiAlergia = boolToBoolean(formData.alergias);

  if (textoAlergia || possuiAlergia) {
    const single = removeEmptyDeep({
      Name: textoAlergia || 'Sim',
      Description: textoAlergia
    });
    if (Object.keys(single).length) allergies.push(single);
  }

  const dedup = [];
  const seen = new Set();

  for (const item of allergies) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(item);
    }
  }

  return dedup;
}

// ======================= MEDICAMENTO CONTINUO =======================
function buildMedicines(formData) {
  const medicines = [];

  const parsed = parseGridItems(
    pickFirst(
      formData.medicines,
      formData.Medicines,
      formData.gridMedicines,
      formData['Person.Medicines'],
      formData['person.Medicines'],
      formData.MedicineGrid
    )
  );

  for (const item of parsed) {
    const normalized = removeEmptyDeep({
      Name: safeString(item?.Name || item?.name || item?.nome),
      Description: safeString(item?.Description || item?.description || item?.descricao || item?.obs)
    });
    if (Object.keys(normalized).length) medicines.push(normalized);
  }

  const textoMedicamento = safeString(formData.medicamentoContinuoTexto);
  const possuiMedicamento = boolToBoolean(formData.medicamentoContinuo);

  if (textoMedicamento || possuiMedicamento) {
    const single = removeEmptyDeep({
      Name: textoMedicamento || 'Sim',
      Description: textoMedicamento
    });
    if (Object.keys(single).length) medicines.push(single);
  }

  const dedup = [];
  const seen = new Set();

  for (const item of medicines) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(item);
    }
  }

  return dedup;
}

// ======================= MAPA DE PAISES =======================
const COUNTRY_MAP = {
  'brasil': 'BR', 'brazil': 'BR',
  'estados unidos': 'US', 'united states': 'US', 'eua': 'US', 'usa': 'US',
  'argentina': 'AR', 'chile': 'CL', 'colombia': 'CO', 'peru': 'PE',
  'uruguai': 'UY', 'paraguai': 'PY', 'bolivia': 'BO', 'venezuela': 'VE',
  'mexico': 'MX', 'canada': 'CA', 'cuba': 'CU',
  'portugal': 'PT', 'espanha': 'ES', 'franca': 'FR', 'italia': 'IT',
  'alemanha': 'DE', 'reino unido': 'GB', 'inglaterra': 'GB', 'escocia': 'GB',
  'holanda': 'NL', 'belgica': 'BE', 'suica': 'CH', 'austria': 'AT',
  'suecia': 'SE', 'noruega': 'NO', 'dinamarca': 'DK', 'finlandia': 'FI',
  'russia': 'RU', 'china': 'CN', 'japao': 'JP', 'india': 'IN',
  'australia': 'AU', 'nova zelandia': 'NZ', 'africa do sul': 'ZA',
  'angola': 'AO', 'mocambique': 'MZ', 'nigeria': 'NG', 'kenya': 'KE',
  'israel': 'IL', 'turquia': 'TR', 'egito': 'EG', 'arabia saudita': 'SA',
  'emirados arabes unidos': 'AE', 'qatar': 'QA', 'kuwait': 'KW',
  'coreia do sul': 'KR', 'tailandia': 'TH', 'indonesia': 'ID',
  'singapura': 'SG', 'malasia': 'MY', 'filipinas': 'PH',
  'irlanda': 'IE', 'grecia': 'GR', 'polonia': 'PL', 'republica tcheca': 'CZ',
  'hungria': 'HU', 'romenia': 'RO', 'croacia': 'HR', 'servia': 'RS',
  'ucrania': 'UA', 'panama': 'PA', 'costa rica': 'CR', 'guatemala': 'GT'
};

function countryNameToCode(value) {
  if (!value) return 'BR';

  const raw = value.trim();
  const v = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/^[A-Z]{2,3}$/.test(raw)) return raw;
  return COUNTRY_MAP[v] || raw || 'BR';
}

// ======================= DOCUMENTOS =======================
function buildDocuments(formData, fullName) {
  const docs = [];

  if (safeString(formData.rg)) {
    const rgDoc = removeEmptyDeep({
      Type: '0',
      TypeName: 'RG',
      FullName: fullName,
      Number: safeString(formData.rg),
      Country: 'BR',
      CountryName: 'Brasil'
    });

    rgDoc.ExpireDate = buildExpireDate(formData.dataExpiracao) || {
      year: 2099, month: 1, day: 1, dayOfWeek: 'thursday',
      hour: 0, minutes: 0, seconds: 0, millisecond: 0
    };
    rgDoc.IssueDate = buildExpireDate(formData.dataEmissao) || null;

    docs.push(rgDoc);
  }

  if (safeString(formData.cpf)) {
    docs.push({
      Type: '2',
      TypeName: 'CPF',
      FullName: fullName,
      Number: safeString(formData.cpf),
      Country: 'BR',
      CountryName: 'Brasil',
      ExpireDate: {
        year: 2099, month: 1, day: 1, dayOfWeek: 'thursday',
        hour: 0, minutes: 0, seconds: 0, millisecond: 0
      },
      IssueDate: null
    });
  }

  if (safeString(formData.numPassaporte)) {
    const paisCode = countryNameToCode(safeString(formData.paisEmissor));
    const passDoc = removeEmptyDeep({
      Type: '1',
      TypeName: 'Passaporte',
      FullName: fullName,
      Number: safeString(formData.numPassaporte),
      Country: paisCode,
      CountryName: safeString(formData.paisEmissor) || 'Brasil'
    });

    passDoc.ExpireDate = buildExpireDate(formData.dataExpiracao) || null;
    passDoc.IssueDate = buildExpireDate(formData.dataEmissao) || null;

    docs.push(passDoc);
  }

  if (safeString(formData.numPassaporteEstrangeiro)) {
    const paisEstCode = countryNameToCode(safeString(formData.paisEmissorEstrangeiro));
    const passEstDoc = removeEmptyDeep({
      Type: '1',
      TypeName: 'Passaporte',
      FullName: fullName,
      Number: safeString(formData.numPassaporteEstrangeiro),
      Country: paisEstCode,
      CountryName: safeString(formData.paisEmissorEstrangeiro) || 'Estrangeiro'
    });

    passEstDoc.ExpireDate = buildExpireDate(formData.dataExpiracaoEstrangeiro) || null;
    passEstDoc.IssueDate = buildExpireDate(formData.dataEmissaoEstrangeiro) || null;

    docs.push(passEstDoc);
  }

  if (safeString(formData.rne)) {
    docs.push({
      Type: '5',
      TypeName: 'RNE',
      FullName: fullName,
      Number: safeString(formData.rne),
      Country: 'BR',
      CountryName: 'Brasil',
      ExpireDate: {
        year: 2099, month: 1, day: 1, dayOfWeek: 'thursday',
        hour: 0, minutes: 0, seconds: 0, millisecond: 0
      },
      IssueDate: null
    });
  }

  return docs;
}

// ======================= ENDERECOS =======================
function buildAddresses(formData) {
  const hasAddress =
    safeString(formData.endereco) ||
    safeString(formData.numero) ||
    safeString(formData.complemento) ||
    safeString(formData.bairro) ||
    safeString(formData.cidade) ||
    safeString(formData.estado) ||
    safeString(formData.cep) ||
    safeString(formData.pais);

  if (!hasAddress) return [];

  return [
    removeEmptyDeep({
      Type: '0',
      TypeName: 'Residencial',
      ZipCode: safeString(formData.cep),
      Street: safeString(formData.endereco),
      Number: safeString(formData.numero),
      Complement: safeString(formData.complemento),
      Neighborhood: safeString(formData.bairro),
      City: safeString(formData.cidade),
      State: safeString(formData.estado),
      Country: safeString(formData.pais) || 'Brasil'
    })
  ];
}

// ======================= CONTATOS DE EMERGENCIA =======================
function buildEmergencyContacts(formData) {
  const contacts = [];

  const parsed = parseGridItems(
    pickFirst(formData.emergencyContacts, formData.EmergencyContacts, formData.gridEmergencyContacts)
  );

  for (const item of parsed) {
    const normalized = removeEmptyDeep({
      Name: safeString(item?.Name || item?.name || item?.nome),
      Kinship: safeString(item?.Kinship || item?.kinship || item?.grauParentesco || item?.grau_parentesco),
      Phone: safeString(item?.Phone || item?.phone || item?.telefone || item?.telefoneEmergencia),
      Email: safeString(item?.Email || item?.email || item?.emailEmergencia),
      DoctorName: safeString(item?.DoctorName || item?.doctorName || item?.nomeMedico || item?.nome_medico),
      DoctorPhone: safeString(item?.DoctorPhone || item?.doctorPhone || item?.telefoneMedico || item?.telefone_medico)
    });
    if (Object.keys(normalized).length) contacts.push(normalized);
  }

  const single = removeEmptyDeep({
    Name: safeString(formData.nomeContato),
    Kinship: safeString(formData.grauParentesco),
    Phone: safeString(formData.telefoneEmergencia),
    Email: safeString(formData.emailEmergencia),
    DoctorName: safeString(formData.nomeMedico),
    DoctorPhone: safeString(formData.telefoneMedico)
  });

  if (Object.keys(single).length) contacts.push(single);

  const dedup = [];
  const seen = new Set();

  for (const item of contacts) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(item);
    }
  }

  return dedup;
}

// ======================= VACINAS =======================
function buildVaccines(formData) {
  const vaccines = [];

  const parsed = parseGridItems(
    pickFirst(formData.vaccines, formData.Vaccines, formData.vacinasGrid)
  );

  for (const item of parsed) {
    const normalized = removeEmptyDeep({
      Name: safeString(item?.Name || item?.name || item?.nome || item?.vacinaNome),
      ExpireDate: buildExpireDate(item?.ExpireDate || item?.expireDate || item?.dataValidade || item?.vacinaValidade),
      Obs: safeString(item?.Obs || item?.obs || item?.observacao || item?.vacinaObs)
    });
    if (Object.keys(normalized).length) vaccines.push(normalized);
  }

  const single = removeEmptyDeep({
    Name: safeString(formData.vacinaNome || formData.vacinas),
    ExpireDate: buildExpireDate(formData.vacinaValidade),
    Obs: safeString(formData.vacinaObs || formData.vacinas)
  });

  if (Object.keys(single).length) vaccines.push(single);

  const dedup = [];
  const seen = new Set();

  for (const item of vaccines) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(item);
    }
  }

  return dedup;
}

// ======================= CUSTOM FIELDS =======================
function buildCustomFields(formData, firstName, middleName, lastName, genderName) {
  const cf = {};

  addAliases(cf, ['nomeCompleto', 'NomeCompleto', 'nome_completo'], safeString(formData.nomeCompleto));
  addAliases(cf, ['nome', 'Nome', 'firstName', 'first_name'], firstName);
  addAliases(cf, ['nomeMeio', 'NomeMeio', 'nome_meio', 'middleName', 'middle_name'], middleName);
  addAliases(cf, ['sobrenome', 'Sobrenome', 'lastName', 'last_name'], lastName);
  addAliases(cf, ['chamado', 'Chamado', 'nomeChamado', 'nome_chamado'], safeString(formData.chamado));
  addAliases(cf, ['cpf', 'CPF'], safeString(formData.cpf));
  addAliases(cf, ['rg', 'RG'], safeString(formData.rg));
  addAliases(cf, ['rne', 'RNE'], safeString(formData.rne));
  addAliases(cf, ['dataNascimento', 'DataNascimento', 'data_nascimento'], safeString(formData.nascimento));
  addAliases(cf, ['nacionalidade', 'Nacionalidade'], safeString(formData.nacionalidade));
  addAliases(cf, ['genero', 'Genero', 'sexo', 'Sexo'], safeString(formData.genero));
  addAliases(cf, ['sexoNormalizado', 'SexoNormalizado'], genderName);
  addAliases(cf, ['email', 'Email'], safeString(formData.email));
  addAliases(cf, ['telefone', 'Telefone', 'telefoneCelular', 'telefone_celular'], safeString(formData.telefoneCelular));
  addAliases(cf, ['preferenciaContato', 'PreferenciaContato', 'preferencia_contato'], safeString(formData.preferenciaContato));
  addAliases(cf, ['conheceuLatitudes', 'ConheceuLatitudes', 'conheceu_latitudes'], safeString(formData.conheceuLatitudes));
  addAliases(cf, ['agenciaViagens', 'AgenciaViagens', 'agencia_viagens', 'Person.Agency', 'agency', 'Agency', 'agencia', 'Agencia'], safeString(formData.agenciaViagens));
  addAliases(cf, ['midia', 'Midia', 'Person.Press', 'press', 'Press', 'canalImprensa', 'canal_imprensa', 'midiaDigital', 'midia_digital'], safeString(formData.midia));
  addAliases(cf, ['preferenciaAssento', 'PreferenciaAssento', 'preferencia_assento', 'Person.SeatPreference', 'seatPreference', 'seat_preference', 'assento', 'Assento'], safeString(formData.preferenciaAssento));
  addAliases(cf, ['endereco', 'Endereco'], safeString(formData.endereco));
  addAliases(cf, ['numero', 'Numero', 'numero_endereco'], safeString(formData.numero));
  addAliases(cf, ['complemento', 'Complemento'], safeString(formData.complemento));
  addAliases(cf, ['bairro', 'Bairro'], safeString(formData.bairro));
  addAliases(cf, ['cidade', 'Cidade'], safeString(formData.cidade));
  addAliases(cf, ['uf', 'UF', 'estado', 'Estado'], safeString(formData.estado));
  addAliases(cf, ['cep', 'CEP'], safeString(formData.cep));
  addAliases(cf, ['pais', 'Pais'], safeString(formData.pais) || 'Brasil');
  addAliases(cf, ['numPassaporte', 'NumPassaporte', 'num_passaporte'], safeString(formData.numPassaporte));
  addAliases(cf, ['paisEmissor', 'PaisEmissor', 'pais_emissor', 'Person.IssuingCountry', 'issuingCountry', 'issuing_country'], safeString(formData.paisEmissor));
  addAliases(cf, ['dataEmissao', 'DataEmissao', 'data_emissao', 'Person.IssueDate', 'issueDate', 'issue_date'], safeString(formData.dataEmissao));
  addAliases(cf, ['dataExpiracao', 'DataExpiracao', 'data_expiracao'], safeString(formData.dataExpiracao));
  addAliases(cf, ['possuiPassaporteEstrangeiro', 'possui_passaporte_estrangeiro'], boolToSimNao(boolToBoolean(formData.possuiPassaporteEstrangeiro)));
  addAliases(cf, ['numPassaporteEstrangeiro', 'num_passaporte_estrangeiro'], safeString(formData.numPassaporteEstrangeiro));
  addAliases(cf, ['paisEmissorEstrangeiro', 'pais_emissor_estrangeiro'], safeString(formData.paisEmissorEstrangeiro));
  addAliases(cf, ['dataEmissaoEstrangeiro', 'data_emissao_estrangeiro'], safeString(formData.dataEmissaoEstrangeiro));
  addAliases(cf, ['dataExpiracaoEstrangeiro', 'data_expiracao_estrangeiro'], safeString(formData.dataExpiracaoEstrangeiro));
  addAliases(cf, ['nomeContato', 'NomeContato', 'nome_contato', 'nome_contato_emergencia'], safeString(formData.nomeContato));
  addAliases(cf, ['grauParentesco', 'GrauParentesco', 'grau_parentesco'], safeString(formData.grauParentesco));
  addAliases(cf, ['telefoneEmergencia', 'TelefoneEmergencia', 'telefone_emergencia'], safeString(formData.telefoneEmergencia));
  addAliases(cf, ['emailEmergencia', 'EmailEmergencia', 'email_emergencia'], safeString(formData.emailEmergencia));
  addAliases(cf, ['nomeMedico', 'NomeMedico', 'nome_medico'], safeString(formData.nomeMedico));
  addAliases(cf, ['telefoneMedico', 'TelefoneMedico', 'telefone_medico'], safeString(formData.telefoneMedico));
  addAliases(cf, ['altura', 'Altura', 'Person.Height'], safeString(formData.altura));
  addAliases(cf, ['peso', 'Peso', 'Person.Weight'], safeString(formData.peso));
  addAliases(cf, ['tamanhoRoupa', 'TamanhoRoupa', 'tamanho_roupa', 'Person.ClothingNumber'], safeString(formData.tamanhoRoupa));
  addAliases(cf, ['numeroCalcado', 'NumeroCalcado', 'numero_calcado', 'Person.ShoeNumber'], safeString(formData.numeroCalcado));
  addAliases(cf, ['idiomas', 'Idiomas', 'Person.Languages'], safeString(formData.idiomas));
  addAliases(cf, ['tipoSanguineo', 'TipoSanguineo', 'tipo_sanguineo', 'Person.BloodType'], safeString(formData.tipoSanguineo));
  addAliases(cf, ['Person.Country'], safeString(formData.pais) || 'Brasil');
  addAliases(cf, ['Person.District'], safeString(formData.bairro));
  addAliases(cf, ['Person.PreferredName'], safeString(formData.chamado));
  addAliases(cf, ['Person.Press'], safeString(formData.midia));
  addAliases(cf, ['Person.LastExamDate', 'Person.LastCheckUp'], safeString(formData.dataCheckup));
  addAliases(cf, ['dataCheckup', 'DataCheckup', 'data_checkup'], safeString(formData.dataCheckup));
  addAliases(cf, ['saudavel', 'Saudavel', 'Person.Healthy'], safeString(formData.saudavel));
  addAliases(cf, ['atividadeFisica', 'AtividadeFisica', 'atividade_fisica', 'Person.PhysicalActivity'], safeString(formData.atividadeFisica));
  addAliases(cf, ['sabeNadar', 'SabeNadar', 'sabe_nadar', 'Person.Swim'], safeString(formData.sabeNadar));
  addAliases(cf, ['restricaoFisica', 'RestricaoFisica', 'restricao_fisica'], boolToSimNao(boolToBoolean(formData.restricaoFisica)));
  addAliases(cf, ['restricaoFisicaTexto', 'restricao_fisica_detalhes', 'Person.Condition'], safeString(formData.restricaoFisicaTexto));
  addAliases(cf, ['doencaCronica', 'DoencaCronica', 'doenca_cronica'], boolToSimNao(boolToBoolean(formData.doencaCronica)));
  addAliases(cf, ['doencaCronicaTexto', 'doenca_cronica_detalhes', 'Person.Illness'], safeString(formData.doencaCronicaTexto));

  addAliases(
    cf,
    ['medicamentoContinuo', 'MedicamentoContinuo', 'medicamento_continuo'],
    boolToSimNao(boolToBoolean(formData.medicamentoContinuo))
  );

  addAliases(
    cf,
    [
      'medicamentoContinuoTexto',
      'medicamento_continuo_texto',
      'medicamento_continuo_detalhes',
      'Person.Medicine',
      'person.Medicine',
      'Medicine',
      'medicine',
      'medicamento_detalhes',
      'medicamento_dosagem'
    ],
    safeString(formData.medicamentoContinuoTexto)
  );

  addAliases(cf, ['cirurgia', 'Cirurgia'], boolToSimNao(boolToBoolean(formData.cirurgia)));
  addAliases(cf, ['motivoCirurgia', 'MotivoCirurgia', 'motivo_cirurgia', 'Person.Surgery'], safeString(formData.motivoCirurgia));
  addAliases(cf, ['questaoMedica', 'QuestaoMedica', 'questao_medica'], boolToSimNao(boolToBoolean(formData.questaoMedica)));
  addAliases(cf, ['questaoMedicaTexto', 'questao_medica_detalhes', 'Person.MedicalQuestion'], safeString(formData.questaoMedicaTexto));

  addAliases(cf, ['alergias', 'Alergias'], boolToSimNao(boolToBoolean(formData.alergias)));

  addAliases(
    cf,
    [
      'alergiasTexto',
      'alergias_texto',
      'alergias_detalhes',
      'Person.Allergy',
      'person.Allergy',
      'Allergy',
      'allergy'
    ],
    safeString(formData.alergiasTexto)
  );

  addAliases(cf, ['vacinas', 'Vacinas'], safeString(formData.vacinas));
  addAliases(cf, ['acompanhamentoPsiquiatrico', 'acompanhamento_psiquiatrico', 'Person.PsychiatricQuestion'], safeString(formData.acompanhamentoPsiquiatrico));
  addAliases(cf, ['tratamentoOdontologico', 'tratamento_odontologico', 'Person.DentalQuestion'], safeString(formData.tratamentoOdontologico));
  addAliases(cf, ['fumante', 'Fumante', 'e_fumante', 'Person.Smoker'], boolToSimNao(boolToBoolean(formData.fumante)));

  addAliases(
    cf,
    ['restricoesAlimentares', 'restricoes_alimentares', 'Person.Diet'],
    safeString(formData.restricaoAlimentos || formData.alimentosNaoCome)
  );

  addAliases(cf, ['dieta', 'Dieta'], boolToSimNao(boolToBoolean(formData.dieta)));
  addAliases(cf, ['dietaTexto', 'dieta_detalhes', 'Person.DietQuestion'], safeString(formData.dietaTexto));
  addAliases(cf, ['restricaoAlimentos', 'RestricaoAlimentos', 'restricao_alimentos'], safeString(formData.restricaoAlimentos));

  addAliases(
    cf,
    [
      'alimentosNaoCome',
      'AlimentosNaoCome',
      'alimentos_nao_come',
      'alimentos_que_nao_come',
      'descreva_alimentos_que_voce_nao_come_por_gosto_dieta_ou_restricao',
      'Person.DislikedFood'
    ],
    safeString(formData.restricaoAlimentos || formData.alimentosNaoCome)
  );

  addAliases(cf, ['bebidaAlcoolica', 'BebidaAlcoolica', 'bebida_alcoolica', 'Person.AlcoholicBeverage'], safeString(formData.bebidaAlcoolica));
  addAliases(cf, ['receberCatalogos', 'receber_catalogos', 'gostaria_de_receber_os_nossos_catalogos_fisicos', 'Person.Catalog'], safeString(formData.receberCatalogos));
  addAliases(cf, ['enderecoPostalIgual', 'endereco_postal_igual', 'Person.CatalogQuestion'], safeString(formData.enderecoPostalIgual));
  addAliases(cf, ['enderecoPostalDiferente', 'endereco_postal_diferente', 'Person.CatalogQuestionAddress'], safeString(formData.enderecoPostalDiferente));

  addAliases(
    cf,
    [
      'comentarios',
      'Comentarios',
      'comentarios_extras',
      'comentarios_ou_informacoes_extras_que_considere_necessarios',
      'observacoes',
      'informacoes_adicionais',
      'Person.Comments'
    ],
    safeString(formData.comentarios)
  );

  addAliases(cf, ['outros', 'Outros', 'Person.Other'], safeString(formData.outros));
  addAliases(cf, ['declaracaoVeracidade', 'declaracao_veracidade'], safeString(formData.declaracaoVeracidade));
  addAliases(cf, ['formOrigin', 'form_origin'], safeString(formData.form_origin || 'rdstation-webhook'));
  addAliases(cf, ['sentAt', 'sent_at'], safeString(formData.sent_at || new Date().toISOString()));

  return removeEmptyDeep(cf);
}

// ======================= NORMALIZACAO =======================
function normalizeWebhookPayload(body) {
  const cf = normalizeCustomFields(body.custom_fields);

  return {
    nomeCompleto: pickFirst(body.name, body.nomeCompleto),
    email: pickFirst(body.email, cf.email),
    telefoneCelular: pickFirst(body.personal_phone, body.mobile_phone, body.phone, cf.telefone_celular, cf.telefone, cf.celular),
    chamado: pickFirst(cf.chamado, cf.nome_chamado, cf['Person.PreferredName']),
    nascimento: pickFirst(cf.data_nascimento, cf.nascimento),
    nacionalidade: pickFirst(cf.nacionalidade),
    cpf: pickFirst(cf.cpf),
    rg: pickFirst(cf.rg),
    rne: pickFirst(cf.rne),
    genero: pickFirst(cf.genero, cf.sexo),
    preferenciaContato: pickFirst(cf.preferencia_contato),
    conheceuLatitudes: pickFirst(cf.conheceu_latitudes),
    agenciaViagens: pickFirst(cf.agencia_viagens),
    midia: pickFirst(cf.midia, cf['Person.Press']),
    preferenciaAssento: pickFirst(cf.preferencia_assento),

    endereco: pickFirst(cf.endereco),
    numero: pickFirst(cf.numero, cf.numero_endereco),
    complemento: pickFirst(cf.complemento),
    bairro: pickFirst(cf.bairro, cf['Person.District']),
    cidade: pickFirst(cf.cidade),
    estado: pickFirst(cf.estado, cf.uf),
    cep: pickFirst(cf.cep),
    pais: pickFirst(cf.pais, cf['Person.Country']),

    numPassaporte: pickFirst(cf.num_passaporte),
    paisEmissor: pickFirst(cf.pais_emissor),
    dataEmissao: pickFirst(cf.data_emissao),
    dataExpiracao: pickFirst(cf.data_expiracao),

    possuiPassaporteEstrangeiro: safeString(pickFirst(cf.possui_passaporte_estrangeiro)).toLowerCase() === 'sim',
    numPassaporteEstrangeiro: pickFirst(cf.num_passaporte_estrangeiro),
    paisEmissorEstrangeiro: pickFirst(cf.pais_emissor_estrangeiro),
    dataEmissaoEstrangeiro: pickFirst(cf.data_emissao_estrangeiro),
    dataExpiracaoEstrangeiro: pickFirst(cf.data_expiracao_estrangeiro),

    nomeContato: pickFirst(cf.nome_contato_emergencia, cf.nome_contato),
    grauParentesco: pickFirst(cf.grau_parentesco),
    telefoneEmergencia: pickFirst(cf.telefone_emergencia),
    emailEmergencia: pickFirst(cf.email_emergencia),
    nomeMedico: pickFirst(cf.nome_medico),
    telefoneMedico: pickFirst(cf.telefone_medico),

    altura: pickFirst(cf.altura, cf['Person.Height']),
    peso: pickFirst(cf.peso, cf['Person.Weight']),
    tamanhoRoupa: pickFirst(cf.tamanho_roupa, cf['Person.ClothingNumber']),
    numeroCalcado: pickFirst(cf.numero_calcado, cf['Person.ShoeNumber']),
    idiomas: pickFirst(cf.idiomas, cf['Person.Languages']),
    tipoSanguineo: pickFirst(cf.tipo_sanguineo, cf['Person.BloodType']),
    dataCheckup: pickFirst(cf.data_checkup, cf['Person.LastCheckUp'], cf['Person.LastExamDate']),
    saudavel: pickFirst(cf.saudavel, cf['Person.Healthy']),
    atividadeFisica: pickFirst(cf.atividade_fisica, cf['Person.PhysicalActivity']),
    sabeNadar: pickFirst(cf.sabe_nadar, cf['Person.Swim']),

    restricaoFisica: safeString(pickFirst(cf.restricao_fisica)).toLowerCase() === 'sim',
    restricaoFisicaTexto: pickFirst(cf.restricao_fisica_detalhes, cf['Person.Condition']),

    doencaCronica: safeString(pickFirst(cf.doenca_cronica)).toLowerCase() === 'sim',
    doencaCronicaTexto: pickFirst(cf.doenca_cronica_detalhes, cf['Person.Illness']),

    medicamentoContinuo: safeString(
      pickFirst(cf.medicamento_continuo, cf.medicamentoContinuo, cf['MedicamentoContinuo'])
    ).toLowerCase() === 'sim',

    medicamentoContinuoTexto: pickFirst(
      cf.medicamento_continuo_detalhes,
      cf.medicamento_continuo_texto,
      cf.medicamentoContinuoTexto,
      cf['medicamento_continuo_texto'],
      cf['Person.Medicine'],
      cf['person.Medicine'],
      cf['Medicine'],
      cf['medicine']
    ),

    cirurgia: safeString(pickFirst(cf.cirurgia)).toLowerCase() === 'sim',
    motivoCirurgia: pickFirst(cf.motivo_cirurgia, cf['Person.Surgery']),

    questaoMedica: safeString(pickFirst(cf.questao_medica)).toLowerCase() === 'sim',
    questaoMedicaTexto: pickFirst(cf.questao_medica_detalhes, cf['Person.MedicalQuestion']),

    alergias: safeString(
      pickFirst(cf.alergias, cf.Alergias)
    ).toLowerCase() === 'sim',

    alergiasTexto: pickFirst(
      cf.alergias_detalhes,
      cf.alergias_texto,
      cf.alergiasTexto,
      cf['Person.Allergy'],
      cf['person.Allergy'],
      cf['Allergy'],
      cf['allergy']
    ),

    vacinas: pickFirst(cf.vacinas),
    acompanhamentoPsiquiatrico: pickFirst(cf.acompanhamento_psiquiatrico, cf['Person.PsychiatricQuestion']),
    tratamentoOdontologico: pickFirst(cf.tratamento_odontologico, cf['Person.DentalQuestion']),
    fumante: boolToSimNao(boolToBoolean(pickFirst(cf.e_fumante, cf.fumante, cf['Person.Smoker']))),

    dieta: safeString(pickFirst(cf.dieta)).toLowerCase() === 'sim',
    dietaTexto: pickFirst(cf.dieta_detalhes, cf['Person.DietQuestion']),
    alimentosNaoCome: pickFirst(
      cf.alimentos_nao_come,
      cf.alimentos_que_nao_come,
      cf.descreva_alimentos_que_voce_nao_come_por_gosto_dieta_ou_restricao,
      cf['Person.DislikedFood']
    ),
    restricaoAlimentos: pickFirst(cf.restricao_alimentos),
    bebidaAlcoolica: pickFirst(cf.bebida_alcoolica, cf['Person.AlcoholicBeverage']),
    receberCatalogos: pickFirst(cf.receber_catalogos, cf.gostaria_de_receber_os_nossos_catalogos_fisicos, cf['Person.Catalog']),
    enderecoPostalIgual: pickFirst(cf.endereco_postal_igual, cf['Person.CatalogQuestion']),
    enderecoPostalDiferente: pickFirst(cf.endereco_postal_diferente, cf['Person.CatalogQuestionAddress']),
    comentarios: pickFirst(
      cf.comentarios,
      cf.comentarios_extras,
      cf.comentarios_ou_informacoes_extras_que_considere_necessarios,
      cf.observacoes,
      cf.informacoes_adicionais,
      cf['Person.Comments']
    ),
    outros: pickFirst(cf.outros, cf['Person.Other']),
    declaracaoVeracidade: pickFirst(cf.declaracao_veracidade),
    form_origin: pickFirst(body.form_origin, body.formOrigin, 'rdstation-webhook'),
    sent_at: pickFirst(body.sent_at, body.sentAt, new Date().toISOString())
  };
}

// ======================= TOKEN =======================
async function getEnvisionToken() {
  if (!ENVISION_USERNAME || !ENVISION_PASSWORD) {
    throw new Error('Credenciais nao configuradas');
  }

  const url = `${ENVISION_BASE_URL}/token`;
  const bodyParams = new URLSearchParams();
  bodyParams.append('grant_type', 'password');
  bodyParams.append('username', ENVISION_USERNAME);
  bodyParams.append('password', ENVISION_PASSWORD);

  console.log('[Envision] Solicitando token em', url);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyParams.toString()
  });

  const text = await resp.text();
  console.log('[Envision Token] Status:', resp.status);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) throw new Error(`Falha token: ${resp.status} ${text}`);
  if (!data.access_token) throw new Error('Sem access_token');

  return data.access_token;
}

// ======================= BUILD PAYLOAD POST =======================
function buildPostPayload(formData, existingId = null) {
  const nomeCompleto = safeString(formData.nomeCompleto);
  const email = safeString(formData.email);
  const cpf = safeString(formData.cpf);
  const telefone = safeString(formData.telefoneCelular);

  const { firstName, middleName, lastName } = splitName(nomeCompleto);
  const { gender, genderName } = normalizeGender(formData.genero);

  const identification = cpf || email || `lead-${Date.now()}`;
  const customFields = buildCustomFields(formData, firstName, middleName, lastName, genderName);
  const emergencyContacts = buildEmergencyContacts(formData);
  const vaccines = buildVaccines(formData);
  const documents = buildDocuments(formData, nomeCompleto);
  const allergies = buildAllergies(formData);
  const preferredContact = normalizePreferredContact(formData.preferenciaContato);

  console.log('[Envision] customFields:', JSON.stringify(customFields, null, 2));
  console.log('[Envision] emergencyContacts:', JSON.stringify(emergencyContacts, null, 2));
  console.log('[Envision] vaccines:', JSON.stringify(vaccines, null, 2));
  console.log('[Envision] documents:', JSON.stringify(documents, null, 2));
  console.log('[Envision] allergies:', JSON.stringify(allergies, null, 2));
  console.log('[Envision] preferredContact:', preferredContact);

  const payload = removeEmptyDeep({
    companyContext: {
      consolidator: {
        id: ENVISION_CONSOLIDATOR_ID,
        systemAccountId: ENVISION_CONSOLIDATOR_SYSTEM_ACCOUNT_ID
      },
      travelAgency: {
        id: ENVISION_TRAVEL_AGENCY_ID,
        systemAccountId: ENVISION_TRAVEL_AGENCY_SYSTEM_ACCOUNT_ID
      }
    },
    record: {
      ...(existingId ? { id: existingId } : {}),
      type: ENVISION_RECORD_TYPE,
      systemAccountId: ENVISION_SYSTEM_ACCOUNT_ID,
      travelAgencyId: ENVISION_TRAVEL_AGENCY_ID,
      active: true,

      identification,
      summary: `${nomeCompleto || 'Lead sem nome'} - Person Record`,
      externalId: cpf.replace(/\D/g, '') || email,

      firstName: safeString(formData.chamado) || firstName,
      middleName,
      lastName,
      email,
      phone: telefone,
      gender,
      genderName,

      nationality: safeString(formData.nacionalidade) || 'Brasil',
      city: safeString(formData.cidade),
      adress: safeString(formData.endereco),
      adressNumber: safeString(formData.numero),
      zipCode: safeString(formData.cep),
      uF: safeString(formData.estado),
      birthDate: parseDateParts(formData.nascimento),

      addresses: buildAddresses(formData),
      EmergencyContacts: emergencyContacts,
      Vaccines: vaccines,
      allergy: allergies.length > 0 ? allergies : undefined,

      PreferredContact: preferredContact,
      Height: safeString(formData.altura),
      Weight: safeString(formData.peso),
      ShoeNumber: safeString(formData.numeroCalcado),
      ClothingNumber: safeString(formData.tamanhoRoupa),
      Languages: safeString(formData.idiomas),
      Country: safeString(formData.pais) || 'Brasil',
      District: safeString(formData.bairro),
      PreferredName: safeString(formData.chamado),
      Press: safeString(formData.midia),
      Agency: safeString(formData.agenciaViagens),
      SeatPreference: safeString(formData.preferenciaAssento),
      BloodType: safeString(formData.tipoSanguineo),
      LastExamDate: parseDateParts(formData.dataCheckup),
      LastCheckUp: parseDateParts(formData.dataCheckup),
      Healthy: safeString(formData.saudavel),
      PhysicalActivity: safeString(formData.atividadeFisica),
      Swim: safeString(formData.sabeNadar),
      Catalog: safeString(formData.receberCatalogos),
      CatalogQuestion: safeString(formData.enderecoPostalIgual),
      CatalogQuestionAddress: safeString(formData.enderecoPostalDiferente),

      Condition: safeString(
        formData.restricaoFisicaTexto || boolToSimNao(boolToBoolean(formData.restricaoFisica))
      ),
      Illness: safeString(
        formData.doencaCronicaTexto || boolToSimNao(boolToBoolean(formData.doencaCronica))
      ),
      'person.Medicine': safeString(formData.medicamentoContinuoTexto) ||
        boolToSimNao(boolToBoolean(formData.medicamentoContinuo)),
      Surgery: safeString(
        formData.motivoCirurgia || boolToSimNao(boolToBoolean(formData.cirurgia))
      ),
      MedicalQuestion: safeString(
        formData.questaoMedicaTexto || boolToSimNao(boolToBoolean(formData.questaoMedica))
      ),
      PsychiatricQuestion: safeString(formData.acompanhamentoPsiquiatrico),
      DentalQuestion: safeString(formData.tratamentoOdontologico),
      Smoker: boolToSimNao(boolToBoolean(formData.fumante)),
      AlcoholicBeverage: safeString(formData.bebidaAlcoolica),
      Diet: safeString(formData.restricaoAlimentos || formData.alimentosNaoCome),
      DietQuestion: safeString(
        formData.dietaTexto || boolToSimNao(boolToBoolean(formData.dieta))
      ),
      DislikedFood: safeString(formData.restricaoAlimentos || formData.alimentosNaoCome),
      Comments: safeString(formData.comentarios),
      Other: safeString(formData.outros),

      permissions: {
        edit: true,
        onlineRetrieve: true
      },

      customFields
    }
  });

  payload.record.documents = documents;
  return payload;
}

// ======================= BUILD PAYLOAD PATCH =======================
function buildPatchPayload(formData, existingId) {
  const cpf = safeString(formData.cpf);
  const email = safeString(formData.email);

  const customFields = removeEmptyDeep({
    rg: safeString(formData.rg),
    RG: safeString(formData.rg),
    rne: safeString(formData.rne),
    RNE: safeString(formData.rne),

    numPassaporte: safeString(formData.numPassaporte),
    num_passaporte: safeString(formData.numPassaporte),
    paisEmissor: safeString(formData.paisEmissor),
    pais_emissor: safeString(formData.paisEmissor),
    dataEmissao: safeString(formData.dataEmissao),
    data_emissao: safeString(formData.dataEmissao),
    dataExpiracao: safeString(formData.dataExpiracao),
    data_expiracao: safeString(formData.dataExpiracao),

    possuiPassaporteEstrangeiro: boolToSimNao(boolToBoolean(formData.possuiPassaporteEstrangeiro)),
    possui_passaporte_estrangeiro: boolToSimNao(boolToBoolean(formData.possuiPassaporteEstrangeiro)),
    numPassaporteEstrangeiro: safeString(formData.numPassaporteEstrangeiro),
    num_passaporte_estrangeiro: safeString(formData.numPassaporteEstrangeiro),
    paisEmissorEstrangeiro: safeString(formData.paisEmissorEstrangeiro),
    pais_emissor_estrangeiro: safeString(formData.paisEmissorEstrangeiro),
    dataEmissaoEstrangeiro: safeString(formData.dataEmissaoEstrangeiro),
    data_emissao_estrangeiro: safeString(formData.dataEmissaoEstrangeiro),
    dataExpiracaoEstrangeiro: safeString(formData.dataExpiracaoEstrangeiro),
    data_expiracao_estrangeiro: safeString(formData.dataExpiracaoEstrangeiro),

    nomeContato: safeString(formData.nomeContato),
    nome_contato_emergencia: safeString(formData.nomeContato),
    grauParentesco: safeString(formData.grauParentesco),
    grau_parentesco: safeString(formData.grauParentesco),
    telefoneEmergencia: safeString(formData.telefoneEmergencia),
    telefone_emergencia: safeString(formData.telefoneEmergencia),
    emailEmergencia: safeString(formData.emailEmergencia),
    email_emergencia: safeString(formData.emailEmergencia),
    nomeMedico: safeString(formData.nomeMedico),
    nome_medico: safeString(formData.nomeMedico),
    telefoneMedico: safeString(formData.telefoneMedico),
    telefone_medico: safeString(formData.telefoneMedico),

    altura: safeString(formData.altura),
    'Person.Height': safeString(formData.altura),
    peso: safeString(formData.peso),
    'Person.Weight': safeString(formData.peso),
    tamanhoRoupa: safeString(formData.tamanhoRoupa),
    tamanho_roupa: safeString(formData.tamanhoRoupa),
    'Person.ClothingNumber': safeString(formData.tamanhoRoupa),
    numeroCalcado: safeString(formData.numeroCalcado),
    numero_calcado: safeString(formData.numeroCalcado),
    'Person.ShoeNumber': safeString(formData.numeroCalcado),
    idiomas: safeString(formData.idiomas),
    'Person.Languages': safeString(formData.idiomas),
    tipoSanguineo: safeString(formData.tipoSanguineo),
    tipo_sanguineo: safeString(formData.tipoSanguineo),
    'Person.BloodType': safeString(formData.tipoSanguineo),
    preferenciaAssento: safeString(formData.preferenciaAssento),
    preferencia_assento: safeString(formData.preferenciaAssento),
    dataCheckup: safeString(formData.dataCheckup),
    data_checkup: safeString(formData.dataCheckup),
    'Person.LastCheckUp': safeString(formData.dataCheckup),
    saudavel: safeString(formData.saudavel),
    'Person.Healthy': safeString(formData.saudavel),
    atividadeFisica: safeString(formData.atividadeFisica),
    atividade_fisica: safeString(formData.atividadeFisica),
    'Person.PhysicalActivity': safeString(formData.atividadeFisica),
    sabeNadar: safeString(formData.sabeNadar),
    sabe_nadar: safeString(formData.sabeNadar),
    'Person.Swim': safeString(formData.sabeNadar),

    restricaoFisica: boolToSimNao(boolToBoolean(formData.restricaoFisica)),
    restricao_fisica: boolToSimNao(boolToBoolean(formData.restricaoFisica)),
    restricaoFisicaTexto: safeString(formData.restricaoFisicaTexto),
    restricao_fisica_detalhes: safeString(formData.restricaoFisicaTexto),

    doencaCronica: boolToSimNao(boolToBoolean(formData.doencaCronica)),
    doenca_cronica: boolToSimNao(boolToBoolean(formData.doencaCronica)),
    doencaCronicaTexto: safeString(formData.doencaCronicaTexto),
    doenca_cronica_detalhes: safeString(formData.doencaCronicaTexto),

    medicamentoContinuo: boolToSimNao(boolToBoolean(formData.medicamentoContinuo)),
    medicamento_continuo: boolToSimNao(boolToBoolean(formData.medicamentoContinuo)),
    medicamentoContinuoTexto: safeString(formData.medicamentoContinuoTexto),
    medicamento_continuo_texto: safeString(formData.medicamentoContinuoTexto),
    medicamento_continuo_detalhes: safeString(formData.medicamentoContinuoTexto),
    'Person.Medicine': safeString(formData.medicamentoContinuoTexto),
    'person.Medicine': safeString(formData.medicamentoContinuoTexto),
    Medicine: safeString(formData.medicamentoContinuoTexto),
    medicine: safeString(formData.medicamentoContinuoTexto),

    cirurgia: boolToSimNao(boolToBoolean(formData.cirurgia)),
    motivoCirurgia: safeString(formData.motivoCirurgia),
    motivo_cirurgia: safeString(formData.motivoCirurgia),

    questaoMedica: boolToSimNao(boolToBoolean(formData.questaoMedica)),
    questao_medica: boolToSimNao(boolToBoolean(formData.questaoMedica)),
    questaoMedicaTexto: safeString(formData.questaoMedicaTexto),
    questao_medica_detalhes: safeString(formData.questaoMedicaTexto),

    alergias: boolToSimNao(boolToBoolean(formData.alergias)),
    alergiasTexto: safeString(formData.alergiasTexto),
    alergias_texto: safeString(formData.alergiasTexto),
    alergias_detalhes: safeString(formData.alergiasTexto),
    'Person.Allergy': safeString(formData.alergiasTexto),
    'person.Allergy': safeString(formData.alergiasTexto),
    Allergy: safeString(formData.alergiasTexto),
    allergy: safeString(formData.alergiasTexto),

    vacinas: safeString(formData.vacinas),
    acompanhamentoPsiquiatrico: safeString(formData.acompanhamentoPsiquiatrico),
    acompanhamento_psiquiatrico: safeString(formData.acompanhamentoPsiquiatrico),
    'Person.PsychiatricQuestion': safeString(formData.acompanhamentoPsiquiatrico),
    tratamentoOdontologico: safeString(formData.tratamentoOdontologico),
    tratamento_odontologico: safeString(formData.tratamentoOdontologico),
    'Person.DentalQuestion': safeString(formData.tratamentoOdontologico),
    fumante: boolToSimNao(boolToBoolean(formData.fumante)),
    'Person.Smoker': boolToSimNao(boolToBoolean(formData.fumante)),

    dieta: boolToSimNao(boolToBoolean(formData.dieta)),
    dietaTexto: safeString(formData.dietaTexto),
    dieta_detalhes: safeString(formData.dietaTexto),
    alimentosNaoCome: safeString(formData.restricaoAlimentos || formData.alimentosNaoCome),
    alimentos_nao_come: safeString(formData.restricaoAlimentos || formData.alimentosNaoCome),
    'Person.DislikedFood': safeString(formData.restricaoAlimentos || formData.alimentosNaoCome),
    restricaoAlimentos: safeString(formData.restricaoAlimentos),
    restricao_alimentos: safeString(formData.restricaoAlimentos),
    'Person.Diet': safeString(formData.restricaoAlimentos || formData.alimentosNaoCome),

    bebidaAlcoolica: safeString(formData.bebidaAlcoolica),
    bebida_alcoolica: safeString(formData.bebidaAlcoolica),
    'Person.AlcoholicBeverage': safeString(formData.bebidaAlcoolica),

    receberCatalogos: safeString(formData.receberCatalogos),
    receber_catalogos: safeString(formData.receberCatalogos),
    'Person.Catalog': safeString(formData.receberCatalogos),
    enderecoPostalIgual: safeString(formData.enderecoPostalIgual),
    endereco_postal_igual: safeString(formData.enderecoPostalIgual),
    enderecoPostalDiferente: safeString(formData.enderecoPostalDiferente),
    endereco_postal_diferente: safeString(formData.enderecoPostalDiferente),

    comentarios: safeString(formData.comentarios),
    comentarios_extras: safeString(formData.comentarios),
    'Person.Comments': safeString(formData.comentarios),

    formOrigin: safeString(formData.form_origin),
    form_origin: safeString(formData.form_origin),
    sentAt: safeString(formData.sent_at),
    sent_at: safeString(formData.sent_at)
  });

  return {
    externalId: cpf.replace(/\D/g, '') || email,
    companyContext: {
      consolidator: {
        id: ENVISION_CONSOLIDATOR_ID,
        systemAccountId: ENVISION_CONSOLIDATOR_SYSTEM_ACCOUNT_ID
      },
      travelAgency: {
        id: ENVISION_TRAVEL_AGENCY_ID,
        systemAccountId: ENVISION_TRAVEL_AGENCY_SYSTEM_ACCOUNT_ID
      }
    },
    costCenters: [],
    customFields
  };
}

// ======================= UPSERT =======================
async function sendFormToEnvision(formData) {
  const token = await getEnvisionToken();
  const cpf = safeString(formData.cpf);
  const email = safeString(formData.email);
  const cpfDigits = onlyDigits(cpf);

  let existingId = findRecordIdInMap(cpf, email);
  if (existingId) {
    console.log(`[RecordsMap] ID encontrado no mapa local: ${existingId}`);
  }

  const candidates = [...new Set([cpfDigits, cpf, email].filter(Boolean))];

  if (!existingId) {
    for (const candidate of candidates) {
      try {
        const url = `${ENVISION_BASE_URL}/Records/Query`;
        const body = {
          criteria: `externalId = "${candidate}"`,
          sortFields: [],
          pagingPivotId: 0,
          pagingPivotValues: [],
          additionalInfo: {
            travelAgencyId: ENVISION_TRAVEL_AGENCY_ID,
            systemAccountId: ENVISION_SYSTEM_ACCOUNT_ID
          }
        };

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(body)
        });

        const text = await resp.text();
        console.log(`[Envision] Records/Query (${candidate}) status: ${resp.status} | body: ${text}`);

        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }

        if (resp.ok && data?.successful !== false) {
          const records = Array.isArray(data?.records) ? data.records : [];
          if (records[0]?.id) {
            existingId = records[0].id;
            break;
          }
        }
      } catch (err) {
        console.warn(`[Envision] Erro Records/Query (${candidate}):`, err.message);
      }
    }
  }

  if (existingId) {
    console.log(`[Envision] Registro encontrado! ID: ${existingId}. Fazendo POST com id para atualizar...`);
    const url = `${ENVISION_BASE_URL}${ENVISION_FORM_ENDPOINT}`;
    const payload = buildPostPayload(formData, existingId);

    console.log('[Envision] Payload POST (update):', JSON.stringify(payload, null, 2));

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const text = await resp.text();
    console.log(`[Envision] POST update status: ${resp.status} | body: ${text}`);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) throw new Error(`Erro POST update: ${resp.status} ${text}`);
    if (data?.successful === false) throw new Error(`Envision POST update erro: ${JSON.stringify(data.errors)}`);

    return { action: 'updated', recordId: existingId, ...data };
  }

  console.log('[Envision] Nenhum registro encontrado. Criando novo...');
  const url = `${ENVISION_BASE_URL}${ENVISION_FORM_ENDPOINT}`;
  const payload = buildPostPayload(formData);

  console.log('[Envision] Payload POST:', JSON.stringify(payload, null, 2));

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  console.log(`[Envision] POST status: ${resp.status} | body: ${text}`);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) throw new Error(`Erro POST: ${resp.status} ${text}`);

  return { action: 'created', ...data };
}

// ======================= ROTAS =======================
app.get('/', (req, res) => {
  res.send('Servidor RD Webhook + Envision /Records (Person) online.');
});

app.get('/health', async (req, res) => {
  try {
    if (!RD_CRM_API_TOKEN) {
      return res.status(400).json({
        success: false,
        error: 'RD_CRM_API_TOKEN nao configurado'
      });
    }

    const response = await fetch('https://crm.rdstation.com/api/v1/token/check', {
      method: 'GET',
      headers: {
        Authorization: `Token token=${RD_CRM_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const text = await response.text();
    return res.status(response.status).send(text);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/rdstation-webhook', async (req, res) => {
  try {
    console.log('\n========== WEBHOOK RECEBIDO ==========');
    console.log(JSON.stringify(req.body, null, 2));

    const formData = normalizeWebhookPayload(req.body);

    console.log('\n========== DADOS NORMALIZADOS ==========');
    console.log(JSON.stringify(formData, null, 2));

    if (!formData.nomeCompleto || !formData.email) {
      return res.status(200).json({
        success: false,
        error: 'Campos obrigatorios ausentes.',
        normalized: formData
      });
    }

    try {
      const envisionResult = await sendFormToEnvision(formData);

      return res.status(200).json({
        success: true,
        message: 'Dados enviados ao Envision com sucesso.',
        normalized: formData,
        envision: envisionResult
      });
    } catch (err) {
      console.error('[Webhook] Erro ao enviar ao Envision:', err.message);

      return res.status(200).json({
        success: false,
        error: 'Erro ao integrar com Envision',
        detail: err.message,
        normalized: formData
      });
    }
  } catch (err) {
    console.error('[Webhook] Erro inesperado:', err.message);

    return res.status(200).json({
      success: false,
      error: 'Erro interno',
      detail: err.message
    });
  }
});

app.post('/envision/form', async (req, res) => {
  try {
    const formData = normalizeWebhookPayload(req.body);

    if (!formData.nomeCompleto || !formData.email) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatorios ausentes.'
      });
    }

    const envisionResult = await sendFormToEnvision(formData);

    return res.status(200).json({
      success: true,
      normalized: formData,
      envision: envisionResult
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get('/envision/records/:id', async (req, res) => {
  try {
    const token = await getEnvisionToken();

    const resp = await fetch(`${ENVISION_BASE_URL}/Records/${req.params.id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const text = await resp.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return res.status(resp.status).send(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ======================= START =======================
app.listen(PORT, () => {
  console.log(`✅ Servidor RD Webhook + Envision /Records (Person) rodando em http://localhost:${PORT}`);
  console.log(`[RecordsMap] Arquivo: ${RECORDS_MAP_FILE}`);
});
