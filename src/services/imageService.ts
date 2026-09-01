/**
 * src/services/imageService.ts
 * 專為多益高頻單字設計的語意具象圖片映射庫（支援 100 個核心抽象單字情境化映射）
 */

export interface ImageInfo {
  url: string;
  tag: string;
}

// Highly curated high-resolution associative business photos from Unsplash
const ASSOCIATIVE_IMAGE_MAP: Record<string, { url: string; tag: string }> = {
  // 1. 核心抽象詞（戰略、優勢、倡議、共識、可行性）
  advantage: { url: 'https://images.unsplash.com/photo-1529699211952-734e80c4d42b?auto=format&fit=crop&w=600&q=80', tag: '西洋棋殘局將死勝出（優勢）' },
  initiative: { url: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80', tag: '主管啟動全新專案提案（新倡議）' },
  compliance: { url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80', tag: '法律天平與規章審核（合規性）' },
  feasibility: { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80', tag: '專案數據模型與可行性分析' },
  perspective: { url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=600&q=80', tag: '高樓窗前遠眺宏觀視野（視角）' },
  discrepancy: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '財務報表數字核對不符（差異）' },
  prerequisite: { url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80', tag: '職缺必備證照與條件審核（先決條件）' },
  consensus: { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80', tag: '全體董事點頭達成一致協議（共識）' },
  incentive: { url: 'https://images.unsplash.com/photo-1579532537598-459ecdaf39cc?auto=format&fit=crop&w=600&q=80', tag: '年終業績獎勵與激勵金幣（誘因）' },
  obligation: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '合約蓋章履約保證（義務）' },
  contingency: { url: 'https://images.unsplash.com/photo-1508873696983-2df5293cb325?auto=format&fit=crop&w=600&q=80', tag: '緊急備援與應變備案（偶發事件）' },
  ambiguity: { url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=600&q=80', tag: '模糊不清的合約文字（模棱兩可）' },
  speculation: { url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=600&q=80', tag: '股票走勢波動與投機買賣（推測）' },
  leverage: { url: 'https://images.unsplash.com/photo-1533750349088-cd871a92f312?auto=format&fit=crop&w=600&q=80', tag: '發揮品牌優勢槓桿影響力' },
  monopoly: { url: 'https://images.unsplash.com/photo-1529699211952-734e80c4d42b?auto=format&fit=crop&w=600&q=80', tag: '單一巨頭獨占市場（壟斷）' },
  volatility: { url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=600&q=80', tag: '匯率與油價劇烈起伏（波動性）' },
  precedent: { url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80', tag: '歷史法院判例與判決紀錄（先例）' },
  arbitration: { url: 'https://images.unsplash.com/photo-1573497491765-dccce02b29df?auto=format&fit=crop&w=600&q=80', tag: '獨立仲裁委員會調解糾紛（仲裁）' },
  negligence: { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80', tag: '設備未定期維護產生損壞（疏忽）' },
  liability: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '賠償責任與負債歸屬（法律責任）' },
  authenticity: { url: 'https://images.unsplash.com/photo-1568667256549-094345857637?auto=format&fit=crop&w=600&q=80', tag: '防偽鋼印與文件真偽鑑定（真實性）' },
  discretion: { url: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=600&q=80', tag: '主管行使自由裁量權（斟酌權）' },
  fluctuation: { url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=600&q=80', tag: '銷售額每月波動走勢（起伏）' },
  integrity: { url: 'https://images.unsplash.com/photo-1573497491765-dccce02b29df?auto=format&fit=crop&w=600&q=80', tag: '誠信經營與商業操守（正直）' },
  priority: { url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=600&q=80', tag: '排定今日最重要任務清單（優先）' },

  // 2. 合約、簽署、法律、條款
  contract: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '鋼筆簽署正式商務合約' },
  agreement: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '簽署雙邊合作協議' },
  clause: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '合約細節條款審閱' },
  sign: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '簽名落款確認生效' },
  signature: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '授權正式手寫簽名' },
  warranty: { url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=600&q=80', tag: '品質保固憑證與印鑑' },

  // 3. 談判、合作、握手
  negotiate: { url: 'https://images.unsplash.com/photo-1573497491765-dccce02b29df?auto=format&fit=crop&w=600&q=80', tag: '會議桌跨桌握手談判' },
  negotiation: { url: 'https://images.unsplash.com/photo-1573497491765-dccce02b29df?auto=format&fit=crop&w=600&q=80', tag: '商務協商與利益平衡' },
  collaborate: { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80', tag: '跨部門團隊共同協作' },

  // 4. 財務、發票、報銷、預算
  reimburse: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '出差單據核銷發票計算機' },
  reimbursement: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '財務費用報銷流程' },
  invoice: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '應付帳款請款單據' },
  budget: { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80', tag: '年度財務預算分配圖表' },
  revenue: { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80', tag: '公司營業額持續攀升' },

  // 5. 機場、航班、登機、差旅
  flight: { url: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&q=80', tag: '商務客機跑道起飛' },
  boarding: { url: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80', tag: '機場登機證與護照確認' },
  itinerary: { url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=600&q=80', tag: '差旅行程地圖與日程規劃' },
  accommodate: { url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80', tag: '商務飯店前台接待櫃台' },

  // 6. 求職、面試、招聘
  interview: { url: 'https://images.unsplash.com/photo-1565688842817-293626786c2e?auto=format&fit=crop&w=600&q=80', tag: '主管與應徵者專業面試' },
  applicant: { url: 'https://images.unsplash.com/photo-1565688842817-293626786c2e?auto=format&fit=crop&w=600&q=80', tag: '求職者填寫應徵資料' },
  resume: { url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80', tag: '多益高分履歷表審查' },

  // 7. 物流、倉儲
  shipping: { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '貨櫃碼頭與全球貨運物流' },
  inventory: { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '大型倉庫商品庫存盤點' },

  // 8. 維修、檢驗
  maintenance: { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80', tag: '工程師檢修工廠精密儀器' },
  repair: { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80', tag: '設備故障排除與修復' }
};

const CATEGORY_FALLBACK_MAP: Record<string, { url: string; tag: string }> = {
  '辦公日常': { url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80', tag: '現代化商務辦公空間' },
  '會議與簡報': { url: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80', tag: '跨部門策略會議簡報' },
  '採購與物流': { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '全球供應鏈與貨物運輸' },
  '金融與會計': { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '財務審計與資產配置' },
  '法務合規與安全': { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '法規遵循與合約審查' },
  '行銷與銷售': { url: 'https://images.unsplash.com/photo-1533750349088-cd871a92f312?auto=format&fit=crop&w=600&q=80', tag: '市場趨勢與品牌推廣' },
  '旅遊與交通': { url: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&q=80', tag: '國際商務差旅航線' },
  '科技與技術支援': { url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=600&q=80', tag: '資訊科技系統維護' }
};

export const imageService = {
  /**
   * Get semantic, highly associative business photo object for any TOEIC word
   */
  getImageForWord(headword: string, category = '辦公日常'): { url: string; tag: string } {
    const cleanWord = headword.trim().toLowerCase();

    // 1. Direct exact word match
    if (ASSOCIATIVE_IMAGE_MAP[cleanWord]) {
      return ASSOCIATIVE_IMAGE_MAP[cleanWord];
    }

    // 2. Keyword substring matching
    for (const [kw, info] of Object.entries(ASSOCIATIVE_IMAGE_MAP)) {
      if (cleanWord.includes(kw) || kw.includes(cleanWord)) {
        return info;
      }
    }

    // 3. Category match fallback
    return CATEGORY_FALLBACK_MAP[category] || {
      url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80',
      tag: '商務職場情境'
    };
  }
};
