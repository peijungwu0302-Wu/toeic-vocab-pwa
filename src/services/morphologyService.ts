/**
 * src/services/morphologyService.ts
 * 參考「不背單字」模式之詞根詞綴解構、派生詞家族與多益考點搭配詞庫
 */

export interface MorphologyInfo {
  roots: Array<{ part: string; meaning: string; type: 'prefix' | 'root' | 'suffix' }>;
  mnemonic: string; // 助記口訣 / 構詞邏輯
  wordFamily: Array<{ word: string; pos: string; meaning: string }>; // 派生詞家族
  collocations: string[]; // 多益常考搭配詞
  synonymsDiff?: {
    synonyms: string[];
    explanation: string;
  };
}

// Curated high-frequency morphology & word family dataset for TOEIC words
const MORPHOLOGY_DICT: Record<string, MorphologyInfo> = {
  advantage: {
    roots: [
      { part: 'ad-', meaning: '向前、朝向 (to/forward)', type: 'prefix' },
      { part: 'vant', meaning: '在前面 (front/before)', type: 'root' },
      { part: '-age', meaning: '名詞後綴 (狀態/事物)', type: 'suffix' }
    ],
    mnemonic: '走在大家最前面的狀態 ➔ 【優勢、有利條件】',
    wordFamily: [
      { word: 'advantage', pos: 'n.', meaning: '優勢、好處' },
      { word: 'advantageous', pos: 'adj.', meaning: '有利的、有益的' },
      { word: 'disadvantage', pos: 'n.', meaning: '劣勢、缺點' },
      { word: 'disadvantageous', pos: 'adj.', meaning: '不利的' }
    ],
    collocations: [
      'take advantage of (善用/利用)',
      'competitive advantage (競爭優勢)',
      'have an advantage over (勝過/優於)',
      'mutual advantage (互利互惠)'
    ],
    synonymsDiff: {
      synonyms: ['benefit (利益/津貼)', 'edge (微幅領先優勢)', 'merit (價值/優點)'],
      explanation: 'advantage 強調在競爭中處於領先地位；benefit 側重獲得實質好處或金錢津貼；edge 側重微小但關鍵的優勢。'
    }
  },
  accommodate: {
    roots: [
      { part: 'ac- (ad-)', meaning: '朝向、加強 (to)', type: 'prefix' },
      { part: 'commod', meaning: '適宜、方便 (fit/convenient)', type: 'root' },
      { part: '-ate', meaning: '動詞後綴 (使成為)', type: 'suffix' }
    ],
    mnemonic: '使各方都感到適宜方便 ➔ 【容納、配合需求】',
    wordFamily: [
      { word: 'accommodate', pos: 'v.', meaning: '容納；配合；提供住宿' },
      { word: 'accommodation', pos: 'n.', meaning: '住宿設施；通融' },
      { word: 'accommodating', pos: 'adj.', meaning: '樂於助人的、肯配合的' }
    ],
    collocations: [
      'accommodate requests (配合需求)',
      'accommodate guests (接待/容納賓客)',
      'hotel accommodations (飯店住宿)',
      'make accommodations (做出調整/配合)'
    ],
    synonymsDiff: {
      synonyms: ['adapt (適應/改編)', 'adjust (微調/校準)', 'lodge (寄宿/提供住宿)'],
      explanation: 'accommodate 常用於飯店容納客人或滿足客戶特殊要求；adapt 是主動去適應新環境。'
    }
  },
  negotiate: {
    roots: [
      { part: 'neg-', meaning: '不、非 (not)', type: 'prefix' },
      { part: 'otium', meaning: '休閒、空閒 (leisure)', type: 'root' },
      { part: '-ate', meaning: '動詞後綴', type: 'suffix' }
    ],
    mnemonic: '不再處於休閒狀態，開始嚴肅談公事 ➔ 【協商、談判】',
    wordFamily: [
      { word: 'negotiate', pos: 'v.', meaning: '談判、協商' },
      { word: 'negotiation', pos: 'n.', meaning: '談判會議、協商過程' },
      { word: 'negotiable', pos: 'adj.', meaning: '可協商的、可談的' },
      { word: 'negotiator', pos: 'n.', meaning: '談判代表' }
    ],
    collocations: [
      'negotiate a contract (協商合約)',
      'negotiate terms (談判條款)',
      'price is negotiable (價格可議)',
      'enter into negotiations (展開談判)'
    ]
  },
  reimburse: {
    roots: [
      { part: 're-', meaning: '回、重新 (back/again)', type: 'prefix' },
      { part: 'im- (in-)', meaning: '放入 (into)', type: 'prefix' },
      { part: 'burse', meaning: '錢包 (purse/money)', type: 'root' }
    ],
    mnemonic: '把墊付的錢重新放回錢包 ➔ 【核銷、補償代墊款】',
    wordFamily: [
      { word: 'reimburse', pos: 'v.', meaning: '核銷、償還代墊款' },
      { word: 'reimbursement', pos: 'n.', meaning: '核銷退款、補償金' },
      { word: 'reimbursable', pos: 'adj.', meaning: '可報帳核銷的' }
    ],
    collocations: [
      'reimburse travel expenses (核銷差旅費)',
      'submit for reimbursement (提交核銷申請)',
      'reimbursable expenses (可報銷費用)'
    ]
  }
};

export const morphologyService = {
  /**
   * Get "不背單字" style root/affix, word family, and collocations
   */
  getMorphology(headword: string, category = '商務綜合'): MorphologyInfo {
    const cleanWord = headword.trim().toLowerCase();
    if (MORPHOLOGY_DICT[cleanWord]) {
      return MORPHOLOGY_DICT[cleanWord];
    }

    // Dynamic smart rule-based morphology breakdown for any other English words
    const roots: Array<{ part: string; meaning: string; type: 'prefix' | 'root' | 'suffix' }> = [];

    // Prefix check
    if (cleanWord.startsWith('re')) roots.push({ part: 're-', meaning: '重新、再次 (again/back)', type: 'prefix' });
    else if (cleanWord.startsWith('un') || cleanWord.startsWith('in') || cleanWord.startsWith('im') || cleanWord.startsWith('dis')) roots.push({ part: cleanWord.slice(0, 3) + '-', meaning: '否定、相反 (not/opposite)', type: 'prefix' });
    else if (cleanWord.startsWith('ad') || cleanWord.startsWith('ac') || cleanWord.startsWith('af') || cleanWord.startsWith('ap')) roots.push({ part: cleanWord.slice(0, 2) + '-', meaning: '朝向、加強 (to/forward)', type: 'prefix' });
    else if (cleanWord.startsWith('pro')) roots.push({ part: 'pro-', meaning: '向前、支持 (forward/pro)', type: 'prefix' });
    else if (cleanWord.startsWith('con') || cleanWord.startsWith('com')) roots.push({ part: cleanWord.slice(0, 3) + '-', meaning: '共同、一起 (together/with)', type: 'prefix' });

    // Suffix check
    if (cleanWord.endsWith('tion') || cleanWord.endsWith('sion')) roots.push({ part: '-tion', meaning: '名詞後綴 (動作/狀態)', type: 'suffix' });
    else if (cleanWord.endsWith('able') || cleanWord.endsWith('ible')) roots.push({ part: '-able', meaning: '形容詞後綴 (能夠...的)', type: 'suffix' });
    else if (cleanWord.endsWith('ment')) roots.push({ part: '-ment', meaning: '名詞後綴 (結果/機構)', type: 'suffix' });
    else if (cleanWord.endsWith('ate') || cleanWord.endsWith('ize') || cleanWord.endsWith('ise')) roots.push({ part: '-ate', meaning: '動詞後綴 (使成為)', type: 'suffix' });
    else if (cleanWord.endsWith('ive') || cleanWord.endsWith('ous')) roots.push({ part: '-ive', meaning: '形容詞後綴 (具備...特性的)', type: 'suffix' });

    if (roots.length === 0) {
      roots.push({ part: cleanWord, meaning: `核心字根 (${category})`, type: 'root' });
    }

    return {
      roots,
      mnemonic: `多益核心高頻詞，專注於【${category}】情境之語意記憶與考點掌握。`,
      wordFamily: [
        { word: cleanWord, pos: '核心詞', meaning: '多益常考釋義' }
      ],
      collocations: [
        `${cleanWord} policy (相關政策)`,
        `review the ${cleanWord} (審查)`,
        `implement ${cleanWord} (實施)`
      ]
    };
  }
};
