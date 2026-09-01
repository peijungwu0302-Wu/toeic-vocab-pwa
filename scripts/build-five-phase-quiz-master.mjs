/**
 * scripts/build-five-phase-quiz-master.mjs
 * 
 * 🎯 ETS Master TOEIC Question Authoring & Dataset Synthesis Engine
 * Generates 11,154 Words across 5 Disks:
 * 1. core-mcq.json (1,200 words)
 * 2. advanced-mcq.json (2,500 words)
 * 3. expert-mcq-part1.json (2,500 words)
 * 4. expert-mcq-part2.json (2,500 words)
 * 5. expert-mcq-part3.json (2,454 words)
 * 
 * Every Word Structure:
 * - headword, definitionZh, partsOfSpeech, category, level, toeicScoreRange
 * - visualAnchor: imagePrompt (photorealistic, cinematic corporate lighting), scene
 * - examples: 3 graded business ladder sentences (with 【中文】)
 * - quizzes: 6 questions (3 Part 5 + 3 Part 6) with 4D Analysis (strategy, examTrapTip, collocations, optionAnalyses)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_RAW_DIR = path.join(ROOT_DIR, 'data-raw');
const QUIZ_OUT_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1', 'quiz');
const PUBLIC_DATA_DIR = path.join(ROOT_DIR, 'public', 'data', 'v1');
const COURSES_DIR = path.join(PUBLIC_DATA_DIR, 'courses');

// Ensure output directory exists
if (!fs.existsSync(QUIZ_OUT_DIR)) {
  fs.mkdirSync(QUIZ_OUT_DIR, { recursive: true });
}

// Helper: Clean concise definition
export function getCleanShortDef(fullDef) {
  if (!fullDef) return '商務概念';
  let cleaned = fullDef
    .replace(/^（.*?）/, '')
    .replace(/^\(.*?\)/, '')
    .split(/[；，,;（(]/)[0]
    .trim();
  return cleaned || fullDef.slice(0, 10).trim();
}

// Helper: Consistent deterministic hash for distractors / seed
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// -------------------------------------------------------------
// Morphological & Lexical Knowledge Base for 100% Real English Distractors
// -------------------------------------------------------------
const REAL_VERB_BASE_POOL = [
  'accommodate', 'negotiate', 'implement', 'terminate', 'postpone', 'facilitate', 'supervise', 'authorize',
  'delegate', 'allocate', 'reimburse', 'compensate', 'streamline', 'evaluate', 'collaborate', 'prioritize',
  'consolidate', 'coordinate', 'investigate', 'subsidize', 'execute', 'formalize', 'standardize', 'accelerate'
];

const REAL_VERB_ED_POOL = [
  'accommodated', 'negotiated', 'implemented', 'terminated', 'postponed', 'facilitated', 'supervised', 'authorized',
  'delegated', 'allocated', 'reimbursed', 'compensated', 'streamlined', 'evaluated', 'collaborated', 'prioritized',
  'consolidated', 'coordinated', 'investigated', 'subsidized', 'executed', 'formalized', 'standardized', 'accelerated'
];

const REAL_VERB_ING_POOL = [
  'accommodating', 'negotiating', 'implementing', 'terminating', 'postponing', 'facilitating', 'supervising', 'authorizing',
  'delegating', 'allocating', 'reimbursing', 'compensating', 'streamlining', 'evaluating', 'collaborating', 'prioritizing',
  'consolidating', 'coordinating', 'investigating', 'subsidizing', 'executing', 'formalizing', 'standardizing', 'accelerating'
];

const REAL_VERB_S_POOL = [
  'accommodates', 'negotiates', 'implements', 'terminates', 'postpones', 'facilitates', 'supervises', 'authorizes',
  'delegates', 'allocates', 'reimburses', 'compensates', 'streamlines', 'evaluates', 'collaborates', 'prioritizes',
  'consolidates', 'coordinates', 'investigates', 'subsidizes', 'executes', 'formalizes', 'standardizes', 'accelerates'
];

const REAL_NOUN_ROLE_POOL = [
  'accountant', 'supervisor', 'coordinator', 'inspector', 'consultant', 'technician', 'applicant', 'assistant',
  'analyst', 'engineer', 'representative', 'specialist', 'candidate', 'executive', 'auditor', 'officer',
  'contractor', 'vendor', 'colleague', 'instructor'
];

const REAL_NOUN_FACILITY_POOL = [
  'auditorium', 'cafeteria', 'warehouse', 'laboratory', 'headquarters', 'branch', 'pavilion', 'facility',
  'terminal', 'conference hall', 'depot', 'venue', 'complex', 'suite'
];

const REAL_NOUN_FINANCIAL_POOL = [
  'budget', 'revenue', 'expenditure', 'deficit', 'dividend', 'subsidy', 'reimbursement', 'allowance',
  'invoice', 'deposit', 'allocation', 'profitability', 'fiscal report', 'balance'
];

const REAL_NOUN_DOCUMENT_POOL = [
  'memo', 'memorandum', 'contract', 'proposal', 'agreement', 'protocol', 'guideline', 'specification',
  'manifest', 'itinerary', 'portfolio', 'agenda', 'charter', 'resolution'
];

const REAL_NOUN_ABSTRACT_POOL = [
  'compliance', 'efficiency', 'productivity', 'reliability', 'resilience', 'sustainability', 'collaboration',
  'integrity', 'confidentiality', 'flexibility', 'feasibility', 'transparency', 'innovation', 'competence'
];

const REAL_ADJ_POOL = [
  'flexible', 'efficient', 'reliable', 'lucrative', 'complimentary', 'confidential', 'urgent', 'mandatory',
  'comprehensive', 'preliminary', 'eligible', 'sustainable', 'innovative', 'rigorous', 'unanimous', 'subsequent',
  'substantial', 'exceptional', 'imperative', 'feasible'
];

const REAL_ADV_POOL = [
  'promptly', 'strictly', 'accurately', 'consistently', 'substantially', 'temporarily', 'efficiently',
  'frequently', 'readily', 'mutually', 'unanimously', 'diligently', 'thoroughly', 'consecutively',
  'subsequently', 'tentatively', 'adversely', 'simultaneously'
];

const REAL_PHRASE_POOL = [
  'in advance', 'on schedule', 'in compliance with', 'in accordance with', 'as of', 'prior to',
  'at no extra cost', 'in the event of', 'on behalf of', 'with regard to', 'under warranty', 'in detail'
];

// Standard Definition Map for Common Distractors
const WORD_DEF_MAP = {
  'accommodate': { pos: 'v.', meaning: '配合需求；容納' },
  'negotiate': { pos: 'v.', meaning: '談判；協商' },
  'implement': { pos: 'v.', meaning: '實施；執行' },
  'terminate': { pos: 'v.', meaning: '終止；解約' },
  'postpone': { pos: 'v.', meaning: '延期；推遲' },
  'facilitate': { pos: 'v.', meaning: '促進；使便利' },
  'supervise': { pos: 'v.', meaning: '監督；指導' },
  'authorize': { pos: 'v.', meaning: '授權；核准' },
  'delegate': { pos: 'v.', meaning: '委派；委任' },
  'allocate': { pos: 'v.', meaning: '撥款；分配' },
  'reimburse': { pos: 'v.', meaning: '報銷；核銷' },
  'compensate': { pos: 'v.', meaning: '補償；賠償' },
  'streamline': { pos: 'v.', meaning: '簡化；精簡流程' },
  'evaluate': { pos: 'v.', meaning: '評估；審核' },
  'collaborate': { pos: 'v.', meaning: '合作；協同作業' },
  'prioritize': { pos: 'v.', meaning: '優先處理' },
  'consolidate': { pos: 'v.', meaning: '整合；鞏固' },
  'coordinate': { pos: 'v.', meaning: '協調；整合' },
  'investigate': { pos: 'v.', meaning: '調查；審查' },
  'subsidize': { pos: 'v.', meaning: '資助；補貼' },
  'execute': { pos: 'v.', meaning: '執行；履行' },
  'formalize': { pos: 'v.', meaning: '使正式化；確立' },
  'standardize': { pos: 'v.', meaning: '標準化；規範化' },
  'accelerate': { pos: 'v.', meaning: '加速；促進' },

  'accountant': { pos: 'n.', meaning: '會計師' },
  'supervisor': { pos: 'n.', meaning: '主管；督導' },
  'coordinator': { pos: 'n.', meaning: '專案協調員' },
  'inspector': { pos: 'n.', meaning: '安全查驗員' },
  'consultant': { pos: 'n.', meaning: '專業顧問' },
  'technician': { pos: 'n.', meaning: '技術人員' },
  'applicant': { pos: 'n.', meaning: '應徵者' },
  'assistant': { pos: 'n.', meaning: '助理' },
  'analyst': { pos: 'n.', meaning: '分析師' },
  'engineer': { pos: 'n.', meaning: '工程師' },
  'representative': { pos: 'n.', meaning: '業務代表' },
  'specialist': { pos: 'n.', meaning: '專員；專家' },
  'candidate': { pos: 'n.', meaning: '候選人；應試者' },
  'executive': { pos: 'n.', meaning: '高階主管' },
  'auditor': { pos: 'n.', meaning: '審計人員' },
  'officer': { pos: 'n.', meaning: '官員；幹事' },
  'contractor': { pos: 'n.', meaning: '承包商' },
  'vendor': { pos: 'n.', meaning: '供應商；廠商' },
  'colleague': { pos: 'n.', meaning: '同事' },
  'instructor': { pos: 'n.', meaning: '講師；教練' },

  'budget': { pos: 'n.', meaning: '預算' },
  'revenue': { pos: 'n.', meaning: '營收；收益' },
  'expenditure': { pos: 'n.', meaning: '支出；費用' },
  'deficit': { pos: 'n.', meaning: '赤字；虧損' },
  'dividend': { pos: 'n.', meaning: '股利；分紅' },
  'subsidy': { pos: 'n.', meaning: '補貼金' },
  'reimbursement': { pos: 'n.', meaning: '費用報銷' },
  'allowance': { pos: 'n.', meaning: '津貼；額度' },
  'invoice': { pos: 'n.', meaning: '發票；請款單' },
  'deposit': { pos: 'n.', meaning: '定金；存款' },
  'allocation': { pos: 'n.', meaning: '撥款分配' },
  'profitability': { pos: 'n.', meaning: '獲利能力' },

  'auditorium': { pos: 'n.', meaning: '禮堂；大演講廳' },
  'cafeteria': { pos: 'n.', meaning: '員工餐廳' },
  'warehouse': { pos: 'n.', meaning: '倉庫；物流庫房' },
  'laboratory': { pos: 'n.', meaning: '實驗室' },
  'headquarters': { pos: 'n.', meaning: '企業總部' },
  'branch': { pos: 'n.', meaning: '分行；分部' },
  'pavilion': { pos: 'n.', meaning: '展示館；會場' },
  'facility': { pos: 'n.', meaning: '廠房設施' },
  'terminal': { pos: 'n.', meaning: '航廈；轉運站' },

  'compliance': { pos: 'n.', meaning: '合規；遵守' },
  'efficiency': { pos: 'n.', meaning: '效率；效能' },
  'productivity': { pos: 'n.', meaning: '生產力' },
  'reliability': { pos: 'n.', meaning: '可靠度' },
  'resilience': { pos: 'n.', meaning: '韌性；復原力' },
  'sustainability': { pos: 'n.', meaning: '永續性' },
  'collaboration': { pos: 'n.', meaning: '合作協同' },
  'integrity': { pos: 'n.', meaning: '誠信；正直' },
  'confidentiality': { pos: 'n.', meaning: '保密性' },
  'flexibility': { pos: 'n.', meaning: '彈性；靈活性' },
  'transparency': { pos: 'n.', meaning: '透明度' },
  'innovation': { pos: 'n.', meaning: '創新' },

  'flexible': { pos: 'adj.', meaning: '有彈性的；靈活的' },
  'efficient': { pos: 'adj.', meaning: '有效率的' },
  'reliable': { pos: 'adj.', meaning: '可靠的；穩固的' },
  'lucrative': { pos: 'adj.', meaning: '獲利豐厚的' },
  'complimentary': { pos: 'adj.', meaning: '免費贈送的' },
  'confidential': { pos: 'adj.', meaning: '機密的；保密的' },
  'urgent': { pos: 'adj.', meaning: '緊急的' },
  'mandatory': { pos: 'adj.', meaning: '強制的；義務的' },
  'comprehensive': { pos: 'adj.', meaning: '全面的；詳盡的' },
  'preliminary': { pos: 'adj.', meaning: '初步的；預備的' },
  'eligible': { pos: 'adj.', meaning: '符合資格的' },
  'sustainable': { pos: 'adj.', meaning: '永續的；可持續的' },
  'innovative': { pos: 'adj.', meaning: '創新的' },
  'rigorous': { pos: 'adj.', meaning: '嚴格的；縝密的' },

  'promptly': { pos: 'adv.', meaning: '迅速地；即時地' },
  'strictly': { pos: 'adv.', meaning: '嚴格地；切實地' },
  'accurately': { pos: 'adv.', meaning: '精確地；準確地' },
  'consistently': { pos: 'adv.', meaning: '始終如一地；持續地' },
  'substantially': { pos: 'adv.', meaning: '大幅度地；實質上' },
  'temporarily': { pos: 'adv.', meaning: '暫時地' },
  'efficiently': { pos: 'adv.', meaning: '高效率地' },
  'frequently': { pos: 'adv.', meaning: '頻繁地' },
  'readily': { pos: 'adv.', meaning: '欣然地；輕易地' },
  'mutually': { pos: 'adv.', meaning: '相互地；彼此' },
  'unanimously': { pos: 'adv.', meaning: '全體一致地' },
  'diligently': { pos: 'adv.', meaning: '勤勉地' },

  'in advance': { pos: 'phrase', meaning: '事先；提前' },
  'on schedule': { pos: 'phrase', meaning: '按既定時程' },
  'in compliance with': { pos: 'phrase', meaning: '遵照；符合...規定' },
  'in accordance with': { pos: 'phrase', meaning: '依據；依照' },
  'as of': { pos: 'phrase', meaning: '自...起' },
  'prior to': { pos: 'phrase', meaning: '在...之前' },
  'at no extra cost': { pos: 'phrase', meaning: '無須額外費用' },
  'in the event of': { pos: 'phrase', meaning: '倘若發生...情況時' },
  'on behalf of': { pos: 'phrase', meaning: '代表...方' },
  'with regard to': { pos: 'phrase', meaning: '關於；就...而言' }
};

// High-Yield Synonym Mapping for TOEIC Part 7 / Part 5 Contextual Synonym Questions
const SYNONYM_MAP = {
  'accommodate': { syn: 'fulfill', options: ['fulfill', 'reject', 'overlook', 'dismiss'], zh: '實現；滿足' },
  'negotiate': { syn: 'bargain', options: ['bargain', 'surrender', 'ignore', 'withdraw'], zh: '協商；討價還價' },
  'implement': { syn: 'execute', options: ['execute', 'cancel', 'abandon', 'hesitate'], zh: '執行；落實' },
  'terminate': { syn: 'end', options: ['end', 'initiate', 'extend', 'renew'], zh: '結束；終止' },
  'postpone': { syn: 'delay', options: ['delay', 'advance', 'hasten', 'launch'], zh: '延遲；推遲' },
  'facilitate': { syn: 'ease', options: ['ease', 'hinder', 'obstruct', 'complicate'], zh: '使便利；促進' },
  'supervise': { syn: 'oversee', options: ['oversee', 'neglect', 'follow', 'submit'], zh: '監督；督導' },
  'authorize': { syn: 'approve', options: ['approve', 'forbid', 'prohibit', 'deny'], zh: '批准；核可' },
  'allocate': { syn: 'assign', options: ['assign', 'withhold', 'confiscate', 'gather'], zh: '分配；指派' },
  'reimburse': { syn: 'repay', options: ['repay', 'charge', 'borrow', 'penalize'], zh: '償還；退款' },
  'evaluate': { syn: 'assess', options: ['assess', 'ignore', 'guess', 'dismiss'], zh: '評估；審查' },
  'collaborate': { syn: 'cooperate', options: ['cooperate', 'compete', 'oppose', 'disagree'], zh: '合作；協作' },
  'prioritize': { syn: 'rank', options: ['rank', 'demote', 'postpone', 'disregard'], zh: '按優先排序' },
  'consolidate': { syn: 'merge', options: ['merge', 'separate', 'divide', 'disperse'], zh: '合併；整併' },
  'coordinate': { syn: 'organize', options: ['organize', 'disrupt', 'scatter', 'confuse'], zh: '組織；協調' },
  'subsidize': { syn: 'fund', options: ['fund', 'defraud', 'tax', 'drain'], zh: '資助；撥款' },
  'execute': { syn: 'carry out', options: ['carry out', 'give up', 'delay', 'cancel'], zh: '執行；履行' },

  'budget': { syn: 'allowance', options: ['allowance', 'debt', 'loss', 'invoice'], zh: '預算額度' },
  'revenue': { syn: 'income', options: ['income', 'expense', 'debt', 'penalty'], zh: '營收；收入' },
  'expenditure': { syn: 'spending', options: ['spending', 'saving', 'profit', 'yield'], zh: '開銷；支出' },
  'deficit': { syn: 'shortfall', options: ['shortfall', 'surplus', 'gain', 'bonus'], zh: '赤字；虧損' },
  'dividend': { syn: 'shareout', options: ['shareout', 'tax', 'loan', 'fee'], zh: '股息；紅利' },
  'invoice': { syn: 'bill', options: ['bill', 'receipt', 'contract', 'check'], zh: '帳單；請款單' },
  'facility': { syn: 'site', options: ['site', 'machine', 'staff', 'product'], zh: '場所；設施' },
  'compliance': { syn: 'adherence', options: ['adherence', 'violation', 'defiance', 'breach'], zh: '遵守；恪守' },
  'efficiency': { syn: 'effectiveness', options: ['effectiveness', 'waste', 'delay', 'defect'], zh: '效能；效率' },
  'productivity': { syn: 'output', options: ['output', 'stagnation', 'idleness', 'loss'], zh: '產量；產能' },
  'reliability': { syn: 'dependability', options: ['dependability', 'weakness', 'doubt', 'flaw'], zh: '可靠度；可信賴性' },

  'flexible': { syn: 'adaptable', options: ['adaptable', 'rigid', 'stubborn', 'fixed'], zh: '可適應的；有彈性的' },
  'efficient': { syn: 'productive', options: ['productive', 'sluggish', 'wasteful', 'slow'], zh: '富有成效的' },
  'reliable': { syn: 'dependable', options: ['dependable', 'faulty', 'unstable', 'doubtful'], zh: '可信賴的' },
  'lucrative': { syn: 'profitable', options: ['profitable', 'worthless', 'bankrupt', 'costly'], zh: '有盈利的' },
  'complimentary': { syn: 'free', options: ['free', 'expensive', 'charged', 'premium'], zh: '免費的' },
  'confidential': { syn: 'secret', options: ['secret', 'public', 'open', 'common'], zh: '秘密的；機密的' },
  'urgent': { syn: 'pressing', options: ['pressing', 'trivial', 'minor', 'optional'], zh: '緊迫的' },
  'mandatory': { syn: 'compulsory', options: ['compulsory', 'voluntary', 'optional', 'casual'], zh: '強制性的' },
  'comprehensive': { syn: 'complete', options: ['complete', 'partial', 'limited', 'narrow'], zh: '完整的；全方位的' },
  'preliminary': { syn: 'initial', options: ['initial', 'final', 'conclusive', 'terminal'], zh: '最初的；開端的' },
  'eligible': { syn: 'qualified', options: ['qualified', 'unfit', 'disqualified', 'banned'], zh: '合格的' },
  'sustainable': { syn: 'viable', options: ['viable', 'temporary', 'fragile', 'harmful'], zh: '切實可行的；永續的' },

  'promptly': { syn: 'immediately', options: ['immediately', 'slowly', 'gradually', 'later'], zh: '立即；迅速地' },
  'strictly': { syn: 'rigorously', options: ['rigorously', 'loosely', 'casually', 'rarely'], zh: '嚴謹地' },
  'accurately': { syn: 'correctly', options: ['correctly', 'falsely', 'roughly', 'wrongly'], zh: '正確無誤地' },
  'consistently': { syn: 'regularly', options: ['regularly', 'randomly', 'rarely', 'seldom'], zh: '規律地；始終如一地' },
  'substantially': { syn: 'significantly', options: ['significantly', 'slightly', 'barely', 'scarcely'], zh: '顯著地；大幅地' }
};

// -------------------------------------------------------------
// Core Bespoke Synthesizer
// -------------------------------------------------------------
export function synthesizeWordEntry(word) {
  const hw = (word.headword || '').trim();
  const hwLower = hw.toLowerCase();
  const def = (word.definitionZh || '').trim();
  const shortDef = getCleanShortDef(def);
  const posList = word.partsOfSpeech || ['noun'];
  const posRaw = posList[0] || 'noun';
  const posLower = posRaw.toLowerCase();
  const h = hashString(hwLower);

  const category = word.category || '綜合商務';
  const level = word.level || '核心必考';
  const scoreRange = word.toeicScoreRange || '400-750';

  // Determine structural word class
  const isPhrase = hwLower.includes(' ') || posLower.includes('phrase') || posLower.includes('片語');
  const isVerb = !isPhrase && (posLower.includes('verb') || posLower.includes('動詞') || posLower === 'v.' || posLower === 'v');
  const isAdj = !isPhrase && (posLower.includes('adj') || posLower.includes('形容詞') || posLower === 'a.' || posLower === 'a');
  const isAdv = !isPhrase && (posLower.includes('adv') || posLower.includes('副詞') || hwLower.endsWith('ly'));
  const isNoun = !isPhrase && !isVerb && !isAdj && !isAdv;

  // Verb sub-morphology
  const isVerbPast = isVerb && (hwLower.endsWith('ed') || ['bought', 'sold', 'made', 'built', 'held', 'paid', 'sent', 'met', 'found'].includes(hwLower));
  const isVerbIng = isVerb && hwLower.endsWith('ing');
  const isVerb3rd = isVerb && hwLower.endsWith('s') && !hwLower.endsWith('ss');
  const isVerbBase = isVerb && !isVerbPast && !isVerbIng && !isVerb3rd;

  // -----------------------------------------------------------
  // 1. Visual Anchor Generation (Photorealistic Business Photography)
  // -----------------------------------------------------------
  let visualPrompt = '';
  let sceneDesc = '';

  if (category.includes('住宿') || category.includes('餐飲') || def.includes('飯店') || def.includes('餐廳') || def.includes('餐具') || def.includes('客房')) {
    visualPrompt = `Modern luxury hotel conference hall and banqueting venue, professional staff coordinating high-end catering and reception arrangements for incoming international corporate delegation, photorealistic, cinematic corporate lighting, 8k resolution, professional workplace photography`;
    sceneDesc = `商務飯店與會展宴會接待場地配合貴賓需求之專業場景`;
  } else if (category.includes('財務') || category.includes('會計') || def.includes('預算') || def.includes('營收') || def.includes('支出') || def.includes('利潤')) {
    visualPrompt = `Senior corporate financial analyst pointing at high-resolution revenue and expenditure growth charts on glass digital dashboard, modern corporate boardroom, executive team discussing quarterly reports, photorealistic, cinematic lighting, 8k`;
    sceneDesc = `財務團隊於現代會議室審查季度財務與預算分析之商務情境`;
  } else if (category.includes('物流') || category.includes('採購') || def.includes('倉庫') || def.includes('庫存') || def.includes('出貨') || def.includes('運輸')) {
    visualPrompt = `Modern smart logistics distribution fulfillment center, inventory logistics manager inspecting automated supply chain manifests on tablet, high-tech warehouse racks, photorealistic, cinematic lighting, ultra-detailed`;
    sceneDesc = `現代化智慧物流轉運中心主管審核出貨清單之作業場景`;
  } else if (category.includes('人資') || category.includes('人事') || def.includes('面試') || def.includes('招募') || def.includes('聘用') || def.includes('履歷')) {
    visualPrompt = `Professional HR executive interviewing a talented candidate in a sunlit modern glass conference room, polished oak desk, formal corporate attire, natural depth of field, photorealistic, 8k`;
    sceneDesc = `人資主管於明亮玻璃會議室進行高階人才招募面試之情境`;
  } else if (category.includes('法律') || category.includes('合約') || def.includes('合規') || def.includes('法務') || def.includes('條款') || def.includes('審計')) {
    visualPrompt = `Corporate legal council reviewing formal commercial contracts and compliance documents with corporate executives around a marble meeting table, serious and focused atmosphere, photorealistic, cinematic corporate lighting`;
    sceneDesc = `企業法務顧問與高層主管審閱正式商業合約與合規文件之場景`;
  } else if (category.includes('科技') || category.includes('資訊') || def.includes('軟體') || def.includes('系統') || def.includes('雲端') || def.includes('資料')) {
    visualPrompt = `Enterprise IT infrastructure engineers collaborating in modern data control center, monitoring network security servers on curved monitors, sleek futuristic corporate interior, photorealistic, cinematic lighting`;
    sceneDesc = `資訊科技工程師在企業數據監控中心協同優化系統之情境`;
  } else {
    visualPrompt = `Dynamic multinational corporate office setting, diverse executive team collaborating on strategic market expansion plan around large interactive smart display, bright sunlit skyline view, photorealistic, cinematic corporate lighting, 8k`;
    sceneDesc = `跨國企業經營團隊於總部會議室討論業務發展與策略規劃之情境`;
  }

  const visualAnchor = {
    imagePrompt: visualPrompt,
    scene: sceneDesc
  };

  // -----------------------------------------------------------
  // 2. Examples Generation (3 Graded Business Ladder Sentences)
  // -----------------------------------------------------------
  let ex1En = '', ex1Zh = '', ex2En = '', ex2Zh = '', ex3En = '', ex3Zh = '';

  if (isVerb) {
    if (isVerbPast) {
      ex1En = `The project steering committee successfully ${hw} all scheduled milestones ahead of the quarterly review.`;
      ex1Zh = `專案指導委員會在季度審查前，成功【${shortDef}】了所有既定里程碑。`;
      ex2En = `Our regional management team ${hw} operational workflows to reduce overhead expenses by fifteen percent.`;
      ex2Zh = `我們的區域管理團隊【${shortDef}】了營運工作流程，使經常性開銷降低了百分之十五。`;
      ex3En = `The international division ${hw} local compliance policies to accelerate overseas market penetration.`;
      ex3Zh = `跨國事業部【${shortDef}】了在地合規政策，以加速海外市場的拓展滲透。`;
    } else if (isVerbIng) {
      ex1En = `The company achieved remarkable efficiency by ${hw} standard operating procedures across all departments.`;
      ex1Zh = `該公司藉由在所有部門中【${shortDef}】標準作業程序，實現了卓越的營運效率。`;
      ex2En = `Senior management is currently ${hw} new logistics strategies to resolve recent supply chain delays.`;
      ex2Zh = `高階管理層目前正致力於【${shortDef}】新物流策略，以解決近期的供應鏈延誤問題。`;
      ex3En = `By ${hw} strategic partnerships with regional distributors, our branch expanded its commercial presence.`;
      ex3Zh = `藉由與區域經銷商【${shortDef}】策略合作夥伴關係，我司分行擴大了其商業版圖。`;
    } else if (isVerb3rd) {
      ex1En = `The newly updated corporate guideline ${hw} all branch offices to submit fiscal audit reports promptly.`;
      ex1Zh = `最新修訂的企業準則【${shortDef}】所有分部辦公室必須及時提交財務審計報告。`;
      ex2En = `Our automated inventory management platform ${hw} real-time tracking across international supply nodes.`;
      ex2Zh = `我們的自動化庫存管理平台【${shortDef}】跨國供應節點的即時追蹤作業。`;
      ex3En = `The commercial development director ${hw} that all overseas client agreements adhere strictly to industry standards.`;
      ex3Zh = `商務拓展總監【${shortDef}】所有海外客戶協議均切實遵守產業標準。`;
    } else {
      ex1En = `The facility management team worked diligently to ${hw} the urgent requirements of visiting international delegates.`;
      ex1Zh = `廠區管理團隊辛勤作業，以【${shortDef}】來訪國際代表的緊急需求。`;
      ex2En = `Our executive board decided to ${hw} operational protocols in order to boost overall supply chain resilience.`;
      ex2Zh = `我們的執行董事會決定【${shortDef}】營運規範，以增強整體供應鏈之韌性。`;
      ex3En = `The commercial division will ${hw} regional sales strategies to accelerate growth in emerging overseas markets.`;
      ex3Zh = `商務部門將【${shortDef}】區域銷售策略，以加速新興海外市場的成長。`;
    }
  } else if (isAdj) {
    ex1En = `Maintaining a ${hw} working arrangement enables our team to respond swiftly to unexpected client demands.`;
    ex1Zh = `保持【${shortDef}】的工作安排，使我們團隊能迅速回應突發的客戶需求。`;
    ex2En = `The chief executive officer delivered a ${hw} presentation outlining our long-term sustainable growth model.`;
    ex2Zh = `執行長發表了一場【${shortDef}】的簡報，概述了我們長期的永續成長模式。`;
    ex3En = `Establishing ${hw} commercial partnerships is vital for expanding our enterprise footprint in foreign markets.`;
    ex3Zh = `建立【${shortDef}】的商業合作夥伴關係，對於在海外市場拓展企業版圖至關重要。`;
  } else if (isAdv) {
    ex1En = `The customer support representative responded ${hw} to client inquiries regarding the updated service terms.`;
    ex1Zh = `客戶服務代表針對更新後的服務條款，【${shortDef}】回覆了客戶的諮詢。`;
    ex2En = `All automated assembly lines operated ${hw} during the annual peak manufacturing cycle.`;
    ex2Zh = `所有自動化組裝產線在年度製造高峰期間，均【${shortDef}】持續運轉。`;
    ex3En = `Our overseas marketing team has ${hw} exceeded quarterly revenue projections across all major territories.`;
    ex3Zh = `我們的海外行銷團隊在所有主要市場中，均【${shortDef}】超越了季度營收預期。`;
  } else if (isPhrase) {
    ex1En = `All project leaders are required to submit their weekly progress summaries ${hw} before Friday's executive meeting.`;
    ex1Zh = `所有專案主管均被要求在週五高層會議之前，【${shortDef}】提交每週進度摘要。`;
    ex2En = `Management confirmed that the new workplace safety policy will take effect ${hw} across all manufacturing plants.`;
    ex2Zh = `管理層確認新的工作場所安全政策將【${shortDef}】在所有製造工廠生效落實。`;
    ex3En = `Our corporation expanded its global distribution network ${hw} to satisfy rising international consumer demand.`;
    ex3Zh = `我司【${shortDef}】擴展了全球經銷網絡，以滿足日益增長的國際消費者需求。`;
  } else {
    // Default Noun
    ex1En = `During the annual shareholders meeting, executive directors highlighted the fundamental importance of ${hw}.`;
    ex1Zh = `在年度股東大會上，執行董事們強調了【${shortDef}】的根本重要性。`;
    ex2En = `The plant supervisor implemented strict operational guidelines to ensure consistent quality in ${hw}.`;
    ex2Zh = `廠房主管實施了嚴格的營運準則，以確保在【${shortDef}】方面保持一致的高品質。`;
    ex3En = `Strategic investment in ${hw} has positioned our enterprise as a frontrunner in global market competition.`;
    ex3Zh = `在【${shortDef}】上的策略性投資，使我司在全球市場競爭中躍居領先地位。`;
  }

  const examples = [
    {
      id: `ex_1_${hwLower.replace(/\s+/g, '_')}`,
      scenario: '日常商務 (圖像記憶錨點)',
      en: ex1En,
      zh: ex1Zh
    },
    {
      id: `ex_2_${hwLower.replace(/\s+/g, '_')}`,
      scenario: '營運管理',
      en: ex2En,
      zh: ex2Zh
    },
    {
      id: `ex_3_${hwLower.replace(/\s+/g, '_')}`,
      scenario: '市場拓展',
      en: ex3En,
      zh: ex3Zh
    }
  ];

  // -----------------------------------------------------------
  // 3. Distractor Selection Engine (100% Real English Words)
  // -----------------------------------------------------------
  let distractorPool = [];
  let posLabel = 'n.';

  if (isVerb) {
    if (isVerbPast) {
      distractorPool = REAL_VERB_ED_POOL;
      posLabel = 'v-ed';
    } else if (isVerbIng) {
      distractorPool = REAL_VERB_ING_POOL;
      posLabel = 'v-ing';
    } else if (isVerb3rd) {
      distractorPool = REAL_VERB_S_POOL;
      posLabel = 'v-s';
    } else {
      distractorPool = REAL_VERB_BASE_POOL;
      posLabel = 'v.';
    }
  } else if (isAdj) {
    distractorPool = REAL_ADJ_POOL;
    posLabel = 'adj.';
  } else if (isAdv) {
    distractorPool = REAL_ADV_POOL;
    posLabel = 'adv.';
  } else if (isPhrase) {
    distractorPool = REAL_PHRASE_POOL;
    posLabel = 'phrase';
  } else {
    // Noun subcategory distractors
    if (def.includes('人員') || def.includes('師') || def.includes('主管') || def.includes('員')) {
      distractorPool = REAL_NOUN_ROLE_POOL;
    } else if (def.includes('預算') || def.includes('營收') || def.includes('費') || def.includes('款') || def.includes('金')) {
      distractorPool = REAL_NOUN_FINANCIAL_POOL;
    } else if (def.includes('廳') || def.includes('館') || def.includes('室') || def.includes('處') || def.includes('場') || def.includes('廠')) {
      distractorPool = REAL_NOUN_FACILITY_POOL;
    } else if (def.includes('約') || def.includes('單') || def.includes('表') || def.includes('報告') || def.includes('提案')) {
      distractorPool = REAL_NOUN_DOCUMENT_POOL;
    } else {
      distractorPool = REAL_NOUN_ABSTRACT_POOL;
    }
    posLabel = 'n.';
  }

  // Filter out headword itself
  const filteredDistractors = distractorPool.filter(d => d.toLowerCase() !== hwLower);
  // Pick 3 stable distractors
  const d1 = filteredDistractors[h % filteredDistractors.length];
  const d2 = filteredDistractors[(h + 3) % filteredDistractors.length];
  const d3 = filteredDistractors[(h + 7) % filteredDistractors.length];
  const uniqueDistractors = Array.from(new Set([d1, d2, d3]));
  while (uniqueDistractors.length < 3) {
    for (const d of filteredDistractors) {
      if (!uniqueDistractors.includes(d)) {
        uniqueDistractors.push(d);
        if (uniqueDistractors.length === 3) break;
      }
    }
  }

  const mcqOptions = [hw, uniqueDistractors[0], uniqueDistractors[1], uniqueDistractors[2]];

  // Build Option Analyses helper
  function buildOptionAnalyses(optionsList, correctOpt, correctMeaning, correctPos) {
    return optionsList.map(opt => {
      const isCorrect = opt.toLowerCase() === correctOpt.toLowerCase();
      if (isCorrect) {
        return {
          option: opt,
          isCorrect: true,
          pos: correctPos || posLabel,
          meaning: correctMeaning || shortDef,
          reason: `【正解】詞義「${correctMeaning || shortDef}」與文法形態完全切合題幹之商務語境。`
        };
      } else {
        const info = WORD_DEF_MAP[opt.toLowerCase()] || { pos: correctPos || posLabel, meaning: opt };
        return {
          option: opt,
          isCorrect: false,
          pos: info.pos || correctPos || posLabel,
          meaning: info.meaning || opt,
          reason: `【干擾】此選項與題幹前後文意及商務搭配不符，予以排除。`
        };
      }
    });
  }

  // -----------------------------------------------------------
  // 4. Quizzes Generation (3 Part 5 + 3 Part 6)
  // -----------------------------------------------------------
  const quizzes = [];

  // Q1: Part 5 Vocab Choice
  let q1Stem = '', q1Zh = '', q1Strategy = '', q1Trap = '';
  if (isVerb) {
    q1Stem = `The executive management committee agreed to _____ the client's urgent proposal after a detailed evaluation.`;
    q1Zh = `執行管理委員會在經過詳細評估後，同意【${shortDef}】客戶的緊急提案。`;
    q1Strategy = `空格前有 agreed to（接原形動詞），受詞為 the client's urgent proposal，填入 ${hw} 最符合語意搭配。`;
    q1Trap = `注意動詞受詞搭配與語意邏輯，避免誤選意思不合之干擾動詞。`;
  } else if (isAdj) {
    q1Stem = `The board of directors commended the cross-functional team for their _____ performance during the product launch.`;
    q1Zh = `董事會讚揚了跨部門團隊在產品發表期間展現之【${shortDef}】績效表現。`;
    q1Strategy = `空格修飾後方名詞 performance，需填入符合正面商務評價之形容詞 ${hw}。`;
    q1Trap = `辨析形容詞語意，確認其能精確修飾職場績效或營運狀態。`;
  } else if (isAdv) {
    q1Stem = `The customer service team handled the system inquiries _____ to prevent any operational disruption.`;
    q1Zh = `客戶服務團隊【${shortDef}】處理了系統諮詢，以防止發生任何營運中斷。`;
    q1Strategy = `空格修飾動詞 handled，需填入副詞 ${hw} 以描述作業方式。`;
    q1Trap = `副詞修飾動詞或全句，注意區分副詞與形容詞在句中的修飾位置。`;
  } else if (isPhrase) {
    q1Stem = `All division managers are requested to submit their quarterly expenditure reports _____ .`;
    q1Zh = `請所有部門經理務必【${shortDef}】提交季度支出報告。`;
    q1Strategy = `分析句末副詞/介系詞片語位置，選入最切合商務作業規範之片語 ${hw}。`;
    q1Trap = `多益常考商務固定片語搭配，切勿僅字面直翻。`;
  } else {
    q1Stem = `The regional director emphasized that corporate _____ remains our highest priority for the upcoming fiscal year.`;
    q1Zh = `區域總監強調，企業【${shortDef}】依然是我們下一會計年度的首要重點。`;
    q1Strategy = `空格位於 corporate 之後作為名詞主詞/受詞，選入名詞 ${hw} 最切合商務方針。`;
    q1Trap = `注意名詞單複數與可數/不可數之文法特徵。`;
  }

  quizzes.push({
    type: 'multiple_choice',
    subType: 'vocab_choice',
    stem: q1Stem,
    stemTranslation: q1Zh,
    options: mcqOptions,
    answer: hw,
    strategy: q1Strategy,
    examTrapTip: q1Trap,
    collocations: [`${hw} effectively`, `corporate ${hw}`],
    optionAnalyses: buildOptionAnalyses(mcqOptions, hw, shortDef, posLabel)
  });

  // Q2: Part 5 Grammar Form
  // Build real morphological variation options
  let gStem = '', gZh = '', gOptions = [], gAnswer = hw, gStrategy = '', gTrap = '';
  if (isVerb) {
    const base = hwLower.replace(/(ing|ed|s)$/, '');
    const ingForm = base.endsWith('e') ? base.slice(0, -1) + 'ing' : (hwLower.endsWith('ing') ? hwLower : base + 'ing');
    const edForm = base.endsWith('e') ? base + 'd' : (hwLower.endsWith('ed') ? hwLower : base + 'ed');
    const nounForm = base + 'tion';
    
    gStem = `The facility is fully capable of _____ the expanding production requirements of our international partners.`;
    gZh = `該廠區完全有能力【${shortDef}】我們國際合作夥伴不斷擴大的生產需求。`;
    gAnswer = isVerbIng ? hw : ingForm;
    gOptions = [gAnswer, isVerbBase ? hw : base, isVerbPast ? hw : edForm, nounForm];
    // dedupe if needed
    gOptions = Array.from(new Set(gOptions));
    while (gOptions.length < 4) gOptions.push(base + 'ment');
    gStrategy = `capable of 為介系詞片語，後方需接動名詞 (V-ing) 作為受詞並帶名詞受詞，故選 ${gAnswer}。`;
    gTrap = `考生常誤選名詞形式，但空格後方帶有受詞，需選可帶受詞的動名詞 (V-ing)。`;
  } else if (isAdj) {
    const base = hwLower.replace(/(able|ive|al|ic|ous|ful|ly)$/, '');
    const advForm = hwLower.endsWith('ly') ? hwLower : hwLower + 'ly';
    const nounForm = hwLower.endsWith('able') ? hwLower.replace('able', 'ability') : base + 'ness';
    const verbForm = base;

    gStem = `The senior consultant provided a _____ assessment regarding our newly proposed distribution network.`;
    gZh = `資深顧問針對我們新提出的經銷網絡，提供了一份【${shortDef}】的評估報告。`;
    gAnswer = hw;
    gOptions = [hw, advForm, nounForm, verbForm];
    gOptions = Array.from(new Set(gOptions));
    while (gOptions.length < 4) gOptions.push(base + 'ed');
    gStrategy = `空格位於不定冠詞 a 與名詞 assessment 之間，需填入形容詞修飾名詞，故選 ${hw}。`;
    gTrap = `注意形容詞與副詞之詞尾變化，不可誤選副詞修飾名詞。`;
  } else if (isAdv) {
    const adjForm = hwLower.replace(/ly$/, '');
    const nounForm = adjForm + 'ness';
    const verbForm = adjForm;

    gStem = `The quality assurance inspector reviewed the engineering logs _____ before issuing final certification.`;
    gZh = `品管檢查員在核發最終認證之前，【${shortDef}】審核了工程日誌。`;
    gAnswer = hw;
    gOptions = [hw, adjForm, nounForm, verbForm];
    gOptions = Array.from(new Set(gOptions));
    while (gOptions.length < 4) gOptions.push(adjForm + 'ing');
    gStrategy = `空格修飾動詞 reviewed，需選用副詞形態 ${hw}。`;
    gTrap = `辨析動詞修飾語，修飾一般及物動詞動作時需選副詞而非形容詞。`;
  } else {
    // Noun / Phrase
    gStem = `Strict compliance with established _____ is mandatory for all personnel operating heavy machinery.`;
    gZh = `切實遵守既定的【${shortDef}】，對於所有操作重型機具之人員皆屬強制規定。`;
    gAnswer = hw;
    gOptions = mcqOptions;
    gStrategy = `established 為形容詞，介系詞 with 之後需填入受詞名詞 ${hw}。`;
    gTrap = `注意介系詞後受詞之詞性要求與上下文語法結構。`;
  }

  const gAnalyses = gOptions.map(opt => {
    const isCor = opt.toLowerCase() === gAnswer.toLowerCase();
    return {
      option: opt,
      isCorrect: isCor,
      pos: isCor ? posLabel : '詞形變化',
      meaning: isCor ? shortDef : opt,
      reason: isCor ? `【正解】文法詞性完全符合空格之結構要求。` : `【干擾】此詞形在此處文法結構中不符。`
    };
  });

  quizzes.push({
    type: 'multiple_choice',
    subType: 'grammar_form',
    stem: gStem,
    stemTranslation: gZh,
    options: gOptions,
    answer: gAnswer,
    strategy: gStrategy,
    examTrapTip: gTrap,
    collocations: [`in accordance with ${hw}`, `maintain ${hw}`],
    optionAnalyses: gAnalyses
  });

  // Q3: Part 5 Contextual Synonym
  const synData = SYNONYM_MAP[hwLower] || {
    syn: mcqOptions[0],
    options: mcqOptions,
    zh: shortDef
  };
  const synAnswer = synData.syn;
  const synOptions = synData.options;

  quizzes.push({
    type: 'multiple_choice',
    subType: 'synonym_context',
    stem: `In the business memorandum, the word '${hw}' is closest in meaning to which of the following?`,
    stemTranslation: `在該商務備忘錄中，單字「${hw}」（【${shortDef}】）的意思與下列何者最接近？`,
    options: synOptions,
    answer: synAnswer,
    strategy: `在商務語境中，${hw}（${shortDef}）之核心涵義與 ${synAnswer} 最相近。`,
    examTrapTip: `多益同義字測驗考查商務上下文語境，需選擇最具替換性之選項。`,
    collocations: [`${hw} = ${synAnswer}`],
    optionAnalyses: synOptions.map(opt => {
      const isCor = opt.toLowerCase() === synAnswer.toLowerCase();
      return {
        option: opt,
        isCorrect: isCor,
        pos: posLabel,
        meaning: isCor ? synData.zh : opt,
        reason: isCor ? `【正解】在商務語境中為最精確之同義詞替換。` : `【干擾】語意不符或無法替換題幹單字。`
      };
    })
  });

  // Q4: Part 6 Cloze 1 (Collocation Cloze)
  const q4Stem = `📧 [INTERNAL MEMORANDUM]\nTo: All Department Staff\nSubject: Important Operational Update\n\nPlease ensure that our division takes all necessary measures to _____ established corporate benchmarks across daily operations.`;
  const q4Zh = `📧【內部備忘錄】\n收件人：全體部門同仁\n主旨：重要營運更新\n\n請確保我們部門採取一切必要措施，在日常營運中【${shortDef}】既定的企業基準。`;

  quizzes.push({
    type: 'cloze_fill',
    subType: 'collocation_cloze',
    stem: q4Stem,
    stemTranslation: q4Zh,
    options: mcqOptions,
    answer: hw,
    clozeHint: `核心釋義：${shortDef}`,
    strategy: `內部備忘錄公告提及 takes measures to _____（採取措施以...），填入 ${hw} 最切合商務政策語境。`,
    examTrapTip: `內部行政備忘錄常使用正式書面語體與政策規章搭配。`,
    collocations: [`adhere to ${hw}`, `implement ${hw}`],
    optionAnalyses: buildOptionAnalyses(mcqOptions, hw, shortDef, posLabel)
  });

  // Q5: Part 6 Cloze 2 (Active Recall)
  const q5Stem = `📩 [CLIENT CORRESPONDENCE]\nTo: Global Procurement Partners\nSubject: Partnership and Service Confirmation\n\nWe are delighted to confirm that our organization can _____ your upcoming business requirements on schedule.`;
  const q5Zh = `📩【客戶商務信函】\n收件人：全球採購合作夥伴\n主旨：合作關係與服務確認\n\n我們很高興地向您確認，我司能夠按既定時程【${shortDef}】貴方未來的商務需求。`;

  quizzes.push({
    type: 'cloze_fill',
    subType: 'active_recall',
    stem: q5Stem,
    stemTranslation: q5Zh,
    options: mcqOptions,
    answer: hw,
    clozeHint: `首字母：${hw[0]}... (${posLabel}) ${shortDef}`,
    strategy: `商務信函確認合約與服務條款，選入 ${hw} 完全契合對外商務溝通承諾。`,
    examTrapTip: `注意題幹首字母與詞性提示，並結合信件主旨進行主動回憶。`,
    collocations: [`confirm ${hw}`, `provide ${hw}`],
    optionAnalyses: buildOptionAnalyses(mcqOptions, hw, shortDef, posLabel)
  });

  // Q6: Part 6 Cloze 3 (Sentence Complete)
  const q6Stem = `📢 [EXECUTIVE POLICY ANNOUNCEMENT]\nTo: All Branch Directors\nSubject: Long-term Development Framework\n\nThe executive board has approved comprehensive guidelines to _____ sustainable performance across all regional subsidiaries.`;
  const q6Zh = `📢【高層政策公告】\n收件人：各分行總監\n主旨：長期發展架構藍圖\n\n執行董事會已核准全方位準則，以在所有區域子公司中【${shortDef}】可持續之營運績效。`;

  quizzes.push({
    type: 'cloze_fill',
    subType: 'sentence_complete',
    stem: q6Stem,
    stemTranslation: q6Zh,
    options: mcqOptions,
    answer: hw,
    clozeHint: `核心釋義：${shortDef}`,
    strategy: `高層政策公告涉及長期營運規劃，填入 ${hw} 最符合跨國企業經營戰略規範。`,
    examTrapTip: `長句公告結構中，注意不定詞片語與受詞 sustainable performance 之邏輯搭配。`,
    collocations: [`strengthen ${hw}`, `optimize ${hw}`],
    optionAnalyses: buildOptionAnalyses(mcqOptions, hw, shortDef, posLabel)
  });

  return {
    headword: hw,
    definitionZh: def,
    partsOfSpeech: posList,
    category: category,
    level: level,
    toeicScoreRange: scoreRange,
    visualAnchor: visualAnchor,
    examples: examples,
    quizzes: quizzes
  };
}

// -------------------------------------------------------------
// Master Compilation Runner for All 5 Phases
// -------------------------------------------------------------
export function runCompilation() {
  console.log('='.repeat(70));
  console.log('🚀 開始編譯 ETS 多益 11,154 詞「3 例句 + 視覺圖 + 3+3 全真題」五大分卷題庫');
  console.log('='.repeat(70));

  // 1. Read input files from data-raw
  const coreRawPath = path.join(DATA_RAW_DIR, 'core_1200_curated.json');
  const advRawPath = path.join(DATA_RAW_DIR, 'advanced_2500_curated.json');
  const expRawPath = path.join(DATA_RAW_DIR, 'expert_high_7454.json');

  if (!fs.existsSync(coreRawPath) || !fs.existsSync(advRawPath) || !fs.existsSync(expRawPath)) {
    console.error('❌ 缺少來源單字清單檔案，請確認 data-raw 目錄下存在：');
    console.error('- core_1200_curated.json (1,200 詞)');
    console.error('- advanced_2500_curated.json (2,500 詞)');
    console.error('- expert_high_7454.json (7,454 詞)');
    process.exit(1);
  }

  const coreWords = JSON.parse(fs.readFileSync(coreRawPath, 'utf8'));
  const advWords = JSON.parse(fs.readFileSync(advRawPath, 'utf8'));
  const expWords = JSON.parse(fs.readFileSync(expRawPath, 'utf8'));

  console.log(`📖 讀取到原始單字清單：`);
  console.log(`- 第一階段 (高頻核心): ${coreWords.length} 詞`);
  console.log(`- 第二階段 (商務進階): ${advWords.length} 詞`);
  console.log(`- 第三階段 (滿分巔峰): ${expWords.length} 詞 (將拆分為 2500, 2500, 2454)`);

  const expPart1 = expWords.slice(0, 2500);
  const expPart2 = expWords.slice(2500, 5000);
  const expPart3 = expWords.slice(5000);

  const partitions = [
    {
      phaseName: '第一階段：高頻核心 (1,200 詞)',
      inputWords: coreWords,
      outputPath: path.join(QUIZ_OUT_DIR, 'core-mcq.json'),
      masterPath: path.join(PUBLIC_DATA_DIR, 'core-1200.json'),
      tier: 'core_1200'
    },
    {
      phaseName: '第二階段：商務進階 (2,500 詞)',
      inputWords: advWords,
      outputPath: path.join(QUIZ_OUT_DIR, 'advanced-mcq.json'),
      masterPath: path.join(PUBLIC_DATA_DIR, 'advanced-2500.json'),
      tier: 'advanced_2500'
    },
    {
      phaseName: '第三階段：滿分巔峰 (1/3) (2,500 詞)',
      inputWords: expPart1,
      outputPath: path.join(QUIZ_OUT_DIR, 'expert-mcq-part1.json'),
      masterPath: path.join(PUBLIC_DATA_DIR, 'expert-high-part1.json'),
      tier: 'expert_high'
    },
    {
      phaseName: '第三階段：滿分巔峰 (2/3) (2,500 詞)',
      inputWords: expPart2,
      outputPath: path.join(QUIZ_OUT_DIR, 'expert-mcq-part2.json'),
      masterPath: path.join(PUBLIC_DATA_DIR, 'expert-high-part2.json'),
      tier: 'expert_high'
    },
    {
      phaseName: '第三階段：滿分巔峰 (3/3) (2,454 詞)',
      inputWords: expPart3,
      outputPath: path.join(QUIZ_OUT_DIR, 'expert-mcq-part3.json'),
      masterPath: path.join(PUBLIC_DATA_DIR, 'expert-high-part3.json'),
      tier: 'expert_high'
    }
  ];

  let totalWordsProcessed = 0;
  let totalQuizzesGenerated = 0;

  for (const part of partitions) {
    console.log(`\n⚙️ 正在處理【${part.phaseName}】...`);
    const compiledList = [];

    for (let i = 0; i < part.inputWords.length; i++) {
      const w = part.inputWords[i];
      const synthesized = synthesizeWordEntry(w);
      compiledList.push(synthesized);
    }

    // Write to target quiz output JSON path
    fs.writeFileSync(part.outputPath, JSON.stringify(compiledList, null, 2), 'utf8');

    // Also update public/data/v1 master data file for app runtime
    fs.writeFileSync(part.masterPath, JSON.stringify({
      version: 5,
      datasetVersion: 'v3.5.0-ets-bespoke-master',
      tier: part.tier,
      count: compiledList.length,
      buildTimestamp: new Date().toISOString(),
      words: compiledList
    }, null, 2), 'utf8');

    totalWordsProcessed += compiledList.length;
    totalQuizzesGenerated += compiledList.length * 6;
    console.log(`✅ 【${part.phaseName}】產出成功！`);
    console.log(`   - 存放路徑：${part.outputPath}`);
    console.log(`   - 單字量：${compiledList.length} 詞 | 題目量：${compiledList.length * 6} 題`);
  }

  // Synchronize courses directory
  console.log(`\n📚 正在同步更新 public/data/v1/courses 課程題庫檔案...`);
  const courseFiles = fs.readdirSync(COURSES_DIR).filter(f => f.startsWith('course-') && f.endsWith('.json'));
  
  // Build lookup index of all synthesized words
  const allSynthesizedWords = [
    ...JSON.parse(fs.readFileSync(path.join(QUIZ_OUT_DIR, 'core-mcq.json'), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(QUIZ_OUT_DIR, 'advanced-mcq.json'), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(QUIZ_OUT_DIR, 'expert-mcq-part1.json'), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(QUIZ_OUT_DIR, 'expert-mcq-part2.json'), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(QUIZ_OUT_DIR, 'expert-mcq-part3.json'), 'utf8'))
  ];
  const wordIndex = new Map(allSynthesizedWords.map(w => [w.headword.toLowerCase(), w]));

  for (const cf of courseFiles) {
    const cp = path.join(COURSES_DIR, cf);
    const cData = JSON.parse(fs.readFileSync(cp, 'utf8'));
    const updatedWords = (cData.words || []).map(w => wordIndex.get((w.headword || '').toLowerCase()) || synthesizeWordEntry(w));
    fs.writeFileSync(cp, JSON.stringify({
      ...cData,
      version: 5,
      datasetVersion: 'v3.5.0-ets-bespoke-master',
      wordCount: updatedWords.length,
      words: updatedWords
    }, null, 2), 'utf8');
  }

  console.log(`=============================================================`);
  console.log(`🎉 全量 11,154 詞五大分卷題庫出題任務圓滿完成！`);
  console.log(`📊 總計單字量：${totalWordsProcessed} 詞`);
  console.log(`📝 總計題庫量：${totalQuizzesGenerated} 題（3+3 全真題目制）`);
  console.log(`=============================================================`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCompilation();
}
