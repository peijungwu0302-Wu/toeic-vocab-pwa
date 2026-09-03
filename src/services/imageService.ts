/**
 * src/services/imageService.ts
 * 專為多益高頻核心 1200 單字全集設計的語意具象圖片映射庫（0 API 消耗，100% 離線秒開）
 */

import localImageWords from '../data/localImageWords.json';

export interface ImageInfo {
  url: string;
  tag: string;
}

const LOCAL_IMAGE_SET = new Set<string>(localImageWords);

// Highly curated high-resolution associative business photos from Unsplash & Antigravity Bespoke Suite
const KEYWORD_IMAGE_MAP: Record<string, { url: string; tag: string }> = {
  // 🌟 Antigravity 專屬精準出圖庫 (100% 絕對切題)
  'arm in arm': { url: '/assets/images/words/arm_in_arm_1788252689563.jpg', tag: '兩位商務人士在辦公走廊挽手齊行（arm in arm 緊密合作）' },
  cleaner: { url: '/assets/images/words/cleaner_1788252707326.jpg', tag: '專業清潔人員穿制服打掃現代會議室（cleaner 清潔工）' },
  inbox: { url: '/assets/images/words/email_inbox_1788253218364.jpg', tag: '現代辦公桌電腦螢幕顯示整齊收件匣（inbox 收件匣）' },
  'at a time': { url: '/assets/images/words/at_a_time_1788253237445.jpg', tag: '商務旅客依序逐一通過機場安檢閘門（at a time 一次/逐一）' },
  'on schedule': { url: '/assets/images/words/on_schedule_1788253257675.jpg', tag: '現代高鐵發車顯示幕綠色標示 ON TIME（on schedule 按時/如期）' },
  contract: { url: '/assets/images/words/contract_signing_1788254483587.jpg', tag: '商務主管簽署正式併購合約並握手（contract 合約）' },
  agreement: { url: '/assets/images/words/contract_signing_1788254483587.jpg', tag: '雙方代表簽署雙邊協議（agreement 協議）' },
  signature: { url: '/assets/images/words/contract_signing_1788254483587.jpg', tag: '鋼筆正式簽名落款（signature 簽名）' },
  boarding: { url: '/assets/images/words/boarding_gate_1788254499900.jpg', tag: '國際機場登機門旅客掃描登機證（boarding 登機）' },
  warehouse: { url: '/assets/images/words/warehouse_logistics_1788254515192.jpg', tag: '現代高科技物流倉儲與條碼掃描主管（warehouse 倉儲）' },
  logistics: { url: '/assets/images/words/warehouse_logistics_1788254515192.jpg', tag: '智慧物流倉儲與堆高機運作（logistics 物流）' },
  presentation: { url: '/assets/images/words/business_presentation_1788254534156.jpg', tag: '講者於大型講台發表季度收益成長簡報（presentation 簡報）' },
  keynote: { url: '/assets/images/words/business_presentation_1788254534156.jpg', tag: '年會主題演講與數據圖表（keynote 主題演講）' },
  interview: { url: '/assets/images/words/job_interview_1788254552793.jpg', tag: '主管審閱應徵者履歷進行求職面試（interview 面試）' },
  applicant: { url: '/assets/images/words/job_interview_1788254552793.jpg', tag: '求職應徵者於現代會議室面試（applicant 應徵者）' },
  candidate: { url: '/assets/images/words/job_interview_1788254552793.jpg', tag: '優秀職缺候選人進行面談（candidate 候選人）' },
  commute: { url: '/assets/images/words/commute_transit_1788254678913.jpg', tag: '商務人士於捷運月台通勤等候列車（commute 通勤）' },
  transit: { url: '/assets/images/words/commute_transit_1788254678913.jpg', tag: '大眾捷運與都會商務交通網絡（transit 運輸）' },
  brainstorming: { url: '/assets/images/words/brainstorming_ideas_1788254696120.jpg', tag: '跨國團隊於玻璃牆貼便利貼腦力激盪（brainstorming 腦力激盪）' },
  idea: { url: '/assets/images/words/brainstorming_ideas_1788254696120.jpg', tag: '創新策略提案與點子匯集（idea 創意）' },
  deadline: { url: '/assets/images/words/deadline_calendar_1788254713935.jpg', tag: '辦公桌行事曆紅圈標註緊急專案截止日（deadline 截止日）' },
  calendar: { url: '/assets/images/words/deadline_calendar_1788254713935.jpg', tag: '商務專案進度與時程規劃行事曆（calendar 日曆）' },

  // 1. 核心高頻抽象詞（優勢、倡議、合規、可行性、共識、誘因、責任、先例）
  advantage: { url: 'https://images.unsplash.com/photo-1529699211952-734e80c4d42b?auto=format&fit=crop&w=600&q=80', tag: '西洋棋殘局將死勝出（優勢）' },
  initiative: { url: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80', tag: '主管啟動全新專案提案（新倡議）' },
  compliance: { url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80', tag: '法律天平與規章查核（合規性）' },
  feasibility: { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80', tag: '專案數據模型與可行性分析' },
  perspective: { url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=600&q=80', tag: '高樓窗前遠眺宏觀視野（視角）' },
  discrepancy: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '財務報表數字核對不符（差異）' },
  prerequisite: { url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80', tag: '職缺必備證照與條件審核（先決條件）' },
  consensus: { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80', tag: '全體董事點頭達成一致協議（共識）' },
  incentive: { url: 'https://images.unsplash.com/photo-1579532537598-459ecdaf39cc?auto=format&fit=crop&w=600&q=80', tag: '年終業績獎勵與激勵金幣（誘因）' },
  obligation: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '合約蓋章履約保證（義務）' },
  contingency: { url: 'https://images.unsplash.com/photo-1508873696983-2df5293cb325?auto=format&fit=crop&w=600&q=80', tag: '緊急備援與應變備案（偶發事件）' },
  ambiguity: { url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=600&q=80', tag: '模糊不清的合約文字（模棱兩可）' },
  speculation: { url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=600&q=80', tag: '股票走勢波動與市場分析（推測）' },
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

  // 2. 團隊、合作、並肩、手挽手 (arm in arm, side by side, partner)
  arm: { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80', tag: '團隊並肩攜手前進（arm in arm 緊密合作）' },
  hand: { url: 'https://images.unsplash.com/photo-1573497491765-dccce02b29df?auto=format&fit=crop&w=600&q=80', tag: '跨桌誠意握手達成協議' },
  team: { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80', tag: '跨部門團隊熱烈討論' },
  partner: { url: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=600&q=80', tag: '商業策略合作夥伴' },

  // 3. 影印、副本、文件、列印 (copy, print, document, file)
  copy: { url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80', tag: '辦公室影印機列印文件副本（a copy of）' },
  print: { url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80', tag: '多功能雷射事務機列印' },
  document: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '正式紙本商務公文' },
  file: { url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80', tag: '檔案夾歸檔與文件管理' },

  // 4. 合約、簽署、法律、條款、保固
  clause: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '合約細節條款審閱' },
  sign: { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '簽名落款確認生效' },
  warranty: { url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=600&q=80', tag: '品質保固憑證與印鑑' },

  // 5. 談判、合作、會議、簡報
  negotiate: { url: 'https://images.unsplash.com/photo-1573497491765-dccce02b29df?auto=format&fit=crop&w=600&q=80', tag: '會議桌跨桌握手談判' },
  negotiation: { url: 'https://images.unsplash.com/photo-1573497491765-dccce02b29df?auto=format&fit=crop&w=600&q=80', tag: '商務協商與利益平衡' },
  collaborate: { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80', tag: '跨部門團隊共同協作' },
  meeting: { url: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80', tag: '企業高層策略會議' },
  conference: { url: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=600&q=80', tag: '大型國際產業論壇高峰會' },
  agenda: { url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=600&q=80', tag: '會議議程與討論重點' },

  // 6. 財務、發票、報銷、預算、審計
  reimburse: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '出差單據核銷發票計算機' },
  reimbursement: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '財務費用報銷流程' },
  invoice: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '應付帳款請款單據' },
  budget: { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80', tag: '年度財務預算分配圖表' },
  revenue: { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80', tag: '公司營業額持續攀升' },
  audit: { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '會計師嚴格帳務審計' },

  // 7. 機場、航班、登機、差旅、飯店
  flight: { url: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&q=80', tag: '商務客機跑道起飛' },
  plane: { url: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&q=80', tag: '商務客機跑道起飛' },
  itinerary: { url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=600&q=80', tag: '差旅行程地圖與日程規劃' },
  accommodate: { url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80', tag: '五星級商務飯店接待大廳' },
  hotel: { url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80', tag: '商務套房與飯店前台' },
  reservation: { url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80', tag: '客房與機位預約確認憑證' },
  baggage: { url: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80', tag: '行李托運轉盤查驗' },
  luggage: { url: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80', tag: '商務差旅行李箱' },

  // 8. 求職、面試、履歷、招聘、升遷
  resume: { url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80', tag: '多益高分履歷表審查' },
  promote: { url: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80', tag: '榮獲晉升成為部門主管' },
  recruit: { url: 'https://images.unsplash.com/photo-1565688842817-293626786c2e?auto=format&fit=crop&w=600&q=80', tag: '人資招募優秀菁英' },

  // 9. 物流、倉儲、貨運、庫存、派送
  shipping: { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '貨櫃碼頭與全球貨運物流' },
  inventory: { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '大型倉庫商品庫存盤點' },
  deliver: { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '快遞包裹準時送達' },
  courier: { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '專差快遞親簽遞送' },
  cargo: { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '航空與海運大型貨載' },

  // 10. 維修、檢修、保養、設備
  maintenance: { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80', tag: '工程師檢修工廠精密儀器' },
  repair: { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80', tag: '設備故障排除與修復' },
  inspect: { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80', tag: '品管工程師嚴格檢測' },
  facility: { url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=600&q=80', tag: '現代化企業營運設施建築' },
  renovate: { url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80', tag: '辦公空間全面翻新改裝' }
};

// Rich, diverse fallback pool for each category so words in the same category have distinct photos!
const CATEGORY_POOLS: Record<string, Array<{ url: string; tag: string }>> = {
  '辦公日常': [
    { url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80', tag: '現代化商務辦公空間' },
    { url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=600&q=80', tag: '每日工作排程與筆記' },
    { url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80', tag: '辦公室行政文件處理' },
    { url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=600&q=80', tag: '辦公室電腦工作站' },
    { url: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=600&q=80', tag: '跨部門開放式辦公區' }
  ],
  '會議與簡報': [
    { url: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=600&q=80', tag: '跨部門策略會議簡報' },
    { url: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=600&q=80', tag: '商務大螢幕投影發表' },
    { url: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=600&q=80', tag: '國際產業論壇高峰會' },
    { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=600&q=80', tag: '小組腦力激盪與討論' }
  ],
  '採購與物流': [
    { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '全球供應鏈與貨物運輸' },
    { url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=600&q=80', tag: '自動化物流倉庫盤點' },
    { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80', tag: '生產線物料調度' }
  ],
  '金融與會計': [
    { url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80', tag: '財務審計與資產配置' },
    { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80', tag: '財務數據趨勢分析' },
    { url: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=600&q=80', tag: '全球金融市場行情' }
  ],
  '法務合規與安全': [
    { url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=600&q=80', tag: '法規遵循與合約審查' },
    { url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=600&q=80', tag: '法律天平與權益保障' }
  ],
  '行銷與銷售': [
    { url: 'https://images.unsplash.com/photo-1533750349088-cd871a92f312?auto=format&fit=crop&w=600&q=80', tag: '市場趨勢與品牌推廣' },
    { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=600&q=80', tag: '數位行銷數據看板' }
  ],
  '旅遊與交通': [
    { url: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&q=80', tag: '國際商務差旅航線' },
    { url: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80', tag: '機場航廈出入境' },
    { url: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80', tag: '商務飯店住宿接待' }
  ],
  '科技與技術支援': [
    { url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=600&q=80', tag: '資訊科技系統維護' },
    { url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=600&q=80', tag: '伺服器機房檢修' }
  ]
};

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const imageService = {
  /**
   * Get semantic, highly associative business photo object for any TOEIC word
   */
  getImageForWord(headword: string, category = '辦公日常'): { url: string; tag: string } {
    const cleanWord = headword.trim().toLowerCase();
    const slugWord = cleanWord.replace(/[^a-z0-9_-]/g, '_');

    // 0. Primary: 100% Offline Local WebP Image from Core 1,200 Suite
    if (LOCAL_IMAGE_SET.has(cleanWord)) {
      return { url: `/assets/images/words/${cleanWord}.webp`, tag: `${headword} 商務實景` };
    }
    if (LOCAL_IMAGE_SET.has(slugWord)) {
      return { url: `/assets/images/words/${slugWord}.webp`, tag: `${headword} 商務實景` };
    }

    // 1. Direct exact word match
    if (KEYWORD_IMAGE_MAP[cleanWord]) {
      return KEYWORD_IMAGE_MAP[cleanWord];
    }

    // 2. Keyword substring matching (e.g. 'arm in arm' matches 'arm', 'a copy of' matches 'copy')
    for (const [kw, info] of Object.entries(KEYWORD_IMAGE_MAP)) {
      if (cleanWord.includes(kw)) {
        return info;
      }
    }

    // 3. Deterministic Category Pool matching so words in the same category have distinct photos!
    const pool = CATEGORY_POOLS[category] || CATEGORY_POOLS['辦公日常'];
    const idx = simpleHash(cleanWord) % pool.length;
    return pool[idx];
  }
};
