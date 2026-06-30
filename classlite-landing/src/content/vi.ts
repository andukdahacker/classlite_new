/**
 * vi.ts — Vietnamese strings for the landing site. Story 1.10.
 *
 * Vietnamese is co-primary (project-context UX-2). This file is the
 * canonical Vietnamese surface — `en.ts` mirrors the shape key-for-key.
 *
 * ★ REVIEWER-MANDATORY keys for VN-fluent reviewer pass (12 total —
 * Task 3.9). Flagged in the PR description:
 *
 *   - meta.title
 *   - hero.headline (LP-01 wireframe restored verbatim — Sally BLOCKER #1)
 *   - hero.eyebrow
 *   - painCalculator.line1
 *   - painCalculator.moneyConversion
 *   - painCalculator.assumption
 *   - feature.writing.body
 *   - socialProof.sectionHeader
 *   - socialProof.sectionNote
 *   - socialProof.card1.quote
 *   - pricing.belowCta
 *   - banner.sessionExpired.body
 *
 * VND prices are LOCKED per BLOCKER A8 (2026-06-04). Free 0₫ · Pro
 * 399.000₫/tháng (3.990.000₫/năm) · Studio 999.000₫/tháng
 * (9.990.000₫/năm). The CI script `scripts/check-landing-parity.mjs`
 * embeds these values in a `LOCKED_PRICES` table and fails the build
 * if either locale module drifts. A price change requires updating
 * both `vi.ts`, `en.ts`, AND the `LOCKED_PRICES` table in the same PR
 * (PM sign-off required).
 */
import type { Strings } from './types'

export const strings = {
  meta: {
    title: 'ClassLite — Quản lý Trung tâm IELTS, AI hỗ trợ chấm bài',
    description:
      'Nền tảng quản lý trung tâm IELTS dành cho người Việt — AI hỗ trợ chấm bài Writing và Speaking, quản lý lớp học, theo dõi tiến độ học viên. Miễn phí cho trung tâm nhỏ.',
    ogTitle: 'ClassLite — Quản lý Trung tâm IELTS',
    ogDescription:
      'AI hỗ trợ chấm Writing và Speaking. Quản lý lớp học, học viên, lịch học, doanh thu — tất cả trong một nền tảng. Miễn phí cho trung tâm nhỏ.',
  },
  header: {
    cta: 'Bắt đầu miễn phí',
    nav: {
      features: 'Tính năng',
      pricing: 'Bảng giá',
      proof: 'Khách hàng',
    },
    langToggleLabel: 'English',
    hamburgerLabel: 'Mở menu điều hướng',
  },
  hero: {
    eyebrow: 'Nền tảng quản lý trung tâm IELTS',
    headline:
      'Giáo viên của bạn đang mất 12 phút chấm mỗi bài Writing. ClassLite giảm xuống còn 3 phút.',
    cta: 'Bắt đầu miễn phí',
  },
  painCalculator: {
    line1: '5 giáo viên × 3 giờ/tuần × 48 tuần',
    line2: '= 720 giờ/năm',
    footnote: 'Thời gian dành cho chấm bài Writing',
    moneyConversion: '≈ 150 triệu đồng/năm tiền lương chấm bài',
    assumption: 'Giả định: 200.000 đồng/giờ chi phí giáo viên đầy đủ',
  },
  feature: {
    writing: {
      title: 'AI chấm Writing có gợi ý sửa',
      body: 'AI chấm Writing theo thang IELTS, để lại nhận xét và gợi ý sửa từng đoạn. Giáo viên xem lại trong 3 phút thay vì 12 phút.',
    },
    qa: {
      title: 'Hỏi đáp neo theo đoạn văn',
      body: 'Học viên hỏi đúng đoạn cần hiểu, giáo viên trả lời đúng chỗ — không lạc trong inbox dài.',
    },
    analytics: {
      title: 'Phân tích & cảnh báo học viên rủi ro',
      body: 'Theo dõi điểm Band của từng học viên qua thời gian. Cảnh báo sớm khi học viên có dấu hiệu chững lại.',
    },
  },
  socialProof: {
    sectionHeader: 'Hình dung kết quả với ClassLite',
    sectionNote:
      'Các trung tâm dưới đây là ví dụ minh họa cho giai đoạn ra mắt. Chúng tôi sẽ cập nhật với các trung tâm thật ngay khi đối tác đầu tiên cho phép chia sẻ.',
    card1: {
      center: 'Trung tâm Anh Ngữ Sao Mai',
      outcomeLabel: 'Tiết kiệm thời gian chấm Writing',
      outcomeValue: '-65%',
      quote:
        'Trước đây mỗi tuần tôi mất 15 giờ chấm bài. Bây giờ chỉ còn 5 giờ — thời gian còn lại tôi dạy thêm được một lớp.',
      attribution: 'Cô Phương · Chủ trung tâm',
      stats: '3 chi nhánh · 18 giáo viên · 240 học viên',
    },
    card2: {
      center: 'IELTS Hồng Hà',
      outcomeLabel: 'Tăng doanh thu / giáo viên',
      outcomeValue: '+40%',
      quote:
        'Tôi vừa dạy vừa quản lý một mình. ClassLite cho phép tôi nhận thêm học viên mà không phải thuê trợ giảng.',
      attribution: 'Thầy Minh · Giáo viên kiêm chủ trung tâm',
      stats: '1 cơ sở · 1 giáo viên · 35 học viên',
    },
  },
  pricing: {
    heading: 'Bảng giá minh bạch — Bắt đầu miễn phí',
    toggleMonthly: 'Hàng tháng',
    toggleAnnual: 'Hàng năm',
    annualBadge: '~2 tháng miễn phí',
    popularBadge: 'Phổ biến nhất',
    free: {
      name: 'Free',
      priceMonthly: '0',
      priceAnnual: '0',
      vatNote: 'Giá đã bao gồm VAT 10%',
      description:
        'Tối đa 1 giáo viên + 20 học viên. Đầy đủ tính năng AI chấm bài. Không cần thẻ tín dụng.',
      cta: 'Bắt đầu miễn phí',
    },
    pro: {
      name: 'Pro',
      priceMonthly: '399.000',
      priceAnnual: '3.990.000',
      vatNote: 'Giá đã bao gồm VAT 10%',
      description:
        'Tối đa 10 giáo viên + 200 học viên. AI chấm Writing & Speaking không giới hạn. Phân tích nâng cao.',
      cta: 'Chọn gói Pro',
    },
    studio: {
      name: 'Studio',
      priceMonthly: '999.000',
      priceAnnual: '9.990.000',
      vatNote: 'Giá đã bao gồm VAT 10%',
      description:
        'Không giới hạn giáo viên & học viên. Thương hiệu riêng (white-label). Hỗ trợ ưu tiên qua Zalo.',
      cta: 'Chọn gói Studio',
    },
    belowCta: 'Bắt đầu miễn phí — không cần thẻ tín dụng',
  },
  footer: {
    tagline:
      'Quản lý trung tâm IELTS toàn diện. AI hỗ trợ chấm bài. Sản phẩm Việt cho người Việt.',
    product: 'Sản phẩm',
    legal: 'Pháp lý & Hỗ trợ',
    legalLinks: {
      terms: 'Điều khoản',
      privacy: 'Quyền riêng tư',
      zalo: 'Liên hệ Zalo',
    },
    copyright: '© 2026 ClassLite. Mọi quyền được bảo lưu.',
  },
  banner: {
    sessionExpired: {
      body: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.',
      cta: 'Đăng nhập',
    },
  },
} as const satisfies Strings
