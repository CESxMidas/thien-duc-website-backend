// Seed dữ liệu dự án thật (idempotent — chạy lại nhiều lần vẫn an toàn).
//
// Nguồn nội dung: docs/CAU-HOI-CAN-XAC-NHAN.md câu 1, 2 và 7 (công ty đã xác
// nhận ngày 2026-07-07). Ảnh trỏ vào `public/images/projects/` của frontend.
//
// Chạy:  npm run prisma:seed:projects
//
// Ghi chú mô hình dữ liệu: Fancy Tower là **hạng mục con** (`project_items`)
// của Khu đô thị Hưng Phú chứ không phải dự án độc lập — đúng theo câu 7
// ("Chung cư Fancy Tower — thuộc khu đô thị Hưng Phú") và đúng với cách ảnh
// đang được xếp thư mục (`images/projects/hung-phu/fancy-tower/`).
require('dotenv/config');
const { Client } = require('pg');

/** Field song ngữ: chỉ có tiếng Việt, bản tiếng Anh bổ sung ở Sprint 4. */
const vi = (text) => ({ vi: text });

/**
 * location/category giờ là JSONB song ngữ (EN-FULL-C2). Chấp nhận cả chuỗi cũ
 * (gói vào `{ vi }`) lẫn object `{ vi, en }` đã điền sẵn — trả null nếu trống.
 */
const bilingual = (value) =>
  value == null ? null : typeof value === 'string' ? { vi: value } : value;

/**
 * `highlights` là **mảng field song ngữ**, không phải mảng chuỗi — mapper của
 * frontend (`src/lib/api/mappers.ts`) đọc `.vi` của từng phần tử.
 */
const localizedList = (texts) => JSON.stringify((texts ?? []).map(vi));

const projects = [
  {
    slug: 'khu-do-thi-hung-phu',
    title: 'Khu đô thị Hưng Phú',
    summary:
      'Khu đô thị 11,25 ha tại trung tâm TP. Bến Tre do Thiên Đức làm chủ đầu tư, gồm 330 căn nhà ở thấp tầng và tòa căn hộ Fancy Tower.',
    description:
      'Khu đô thị Hưng Phú tọa lạc mặt tiền đường Nguyễn Thị Định, Phường Phú Tân, TP. Bến Tre, trên khu đất hậu cần Tỉnh đội cũ. Dự án có sổ hồng lâu dài và đã nghiệm thu hạ tầng kỹ thuật. Hạ tầng, đường nội khu, các phân khu nhà phố thấp tầng và tòa căn hộ Fancy Tower đều đã bàn giao, cư dân sinh sống ổn định. Trung tâm thương mại Hưng Phú Mall và nhà trẻ nội khu đang hoàn thiện giai đoạn cuối để đưa vào khai thác.',
    // Toàn khu đô thị đã bàn giao. Hạng mục `hung-phu-mall` vẫn giữ
    // `DANG_THI_CONG` — trung tâm thương mại chưa vận hành, ghi "đã bàn giao"
    // là sai sự thật. Dự án bàn giao mà một tiện ích còn hoàn thiện là bình thường.
    status: 'DA_BAN_GIAO',
    // Địa danh ngắn cho thẻ dự án — địa chỉ đầy đủ nằm ở `quickFacts`.
    location: { vi: 'Bến Tre', en: 'Ben Tre' },
    category: { vi: 'Khu đô thị', en: 'Urban Area' },
    image:
      '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-01.jpg',
    highlights: [
      'Mặt tiền đường Nguyễn Thị Định, ngay khu trung tâm TP. Bến Tre.',
      'Sổ hồng lâu dài, đã nghiệm thu hạ tầng kỹ thuật.',
      'Tòa nhà hành chính Liên Sở của tỉnh nằm trong nội khu.',
      'Tiện ích: khu dịch vụ ngầm, hồ bơi, trường mẫu giáo, trung tâm văn hóa thể dục thể thao, công viên cây xanh, siêu thị.',
    ],
    quickFacts: [
      { label: 'Chủ đầu tư', value: 'Công ty TNHH ĐT - XD - TM Thiên Đức' },
      { label: 'Tổng diện tích', value: '112.521 m² (11,25 ha)' },
      {
        label: 'Sản phẩm thấp tầng',
        value: '330 căn nhà phố liền kề, shophouse, biệt thự',
      },
      {
        label: 'Căn hộ',
        value: '196 căn (Fancy Tower — 19 tầng nổi, 1 tầng hầm)',
      },
      {
        label: 'Pháp lý',
        value: 'Sổ hồng lâu dài, đã nghiệm thu hạ tầng kỹ thuật',
      },
    ],
    gallery: [
      '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-01.jpg',
      '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-02.jpg',
      '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-03.jpg',
      '/images/projects/hung-phu/hotel/hung-phu-hotel-exterior-01.jpg',
      '/images/projects/hung-phu/hotel/hung-phu-hotel-living-room-01.jpg',
      '/images/projects/hung-phu/hotel/hung-phu-hotel-living-room-02.jpg',
      '/images/projects/hung-phu/hotel/hung-phu-hotel-bedroom-double-01.jpg',
      '/images/projects/hung-phu/hotel/hung-phu-hotel-bedroom-twin-01.jpg',
      '/images/projects/hung-phu/hotel/hung-phu-hotel-bedroom-twin-02.jpg',
    ],
    gallerySections: [
      {
        title: 'Khách sạn',
        description:
          'Không gian lưu trú Cannes Hotel với phòng nghỉ hiện đại và tiện nghi đồng bộ trong khu đô thị.',
        images: [
          '/images/projects/hung-phu/hotel/hung-phu-hotel-exterior-01.jpg',
          '/images/projects/hung-phu/hotel/hung-phu-hotel-bedroom-double-01.jpg',
          '/images/projects/hung-phu/hotel/hung-phu-hotel-bedroom-twin-01.jpg',
          '/images/projects/hung-phu/hotel/hung-phu-hotel-bedroom-twin-02.jpg',
          '/images/projects/hung-phu/hotel/hung-phu-hotel-living-room-01.jpg',
          '/images/projects/hung-phu/hotel/hung-phu-hotel-living-room-02.jpg',
        ],
      },
      {
        title: 'Chung cư Fancy Tower',
        description:
          'Tòa căn hộ cao cấp 19 tầng với tiện ích nội khu và không gian sống hiện đại.',
        images: [
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-day-01.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-evening-01.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-plaza-01.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-plaza-02.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-amenity-pool-01.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-amenity-pool-02.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-amenity-pool-03.jpg',
        ],
      },
    ],
    mapLocation: {
      image:
        '/images/projects/hung-phu/location/hung-phu-location-map-base.png',
      googleMapsUrl:
        'https://www.google.com/maps/search/?api=1&query=Kh%C3%B9+%C4%91%C3%B4+th%E1%BB%8B+H%C6%B0ng+Ph%C3%BA+B%E1%BA%BFn+Tre',
      heading: 'Tọa lạc tại trung tâm nổi bật của thành phố Bến Tre',
      description:
        'Phong cách sống sang trọng đi đôi với hệ thống các tiện ích công cộng hiện đại, khu đô thị hứa hẹn mang đến cho thành phố Bến Tre một diện mạo mới.',
      address: 'Phường Phú Tân, thành phố Bến Tre, tỉnh Bến Tre',
      markerLeft: 65,
      markerTop: 27,
      labels: [
        { text: 'Hướng đi chợ Lách', left: 22, top: 9, kind: 'direction' },
        {
          text: 'Hướng đi cầu Rạch Miễu TP.HCM',
          left: 44,
          top: 12,
          kind: 'direction',
        },
        { text: 'Hướng đi Tỉnh Lộ 886', left: 83, top: 9, kind: 'direction' },
        {
          text: 'Hướng đi cầu Hàm Lương',
          left: 24,
          top: 66,
          kind: 'direction',
        },
        { text: 'Tỉnh lộ 887', left: 35, top: 17, kind: 'road' },
        { text: 'QL.60', left: 49, top: 14, kind: 'road' },
        { text: 'Ngã tư Tân Thành', left: 47, top: 28, kind: 'road' },
        { text: 'Ngã tư Phú Khương', left: 56, top: 42, kind: 'road' },
        { text: 'D.Đồng Văn Cống', left: 43, top: 40, kind: 'road' },
        { text: 'D.Nguyễn Thị Định', left: 74, top: 33, kind: 'road' },
        { text: 'D.Đoàn Hoàng Minh', left: 49, top: 57, kind: 'road' },
        { text: 'D.Đồng Khởi', left: 67, top: 52, kind: 'road' },
        { text: 'D.Nguyễn Huệ', left: 80, top: 38, kind: 'road' },
        { text: 'D.Nguyễn Đình Chiểu', left: 84, top: 71, kind: 'road' },
        { text: 'D.Hùng Vương', left: 45, top: 90, kind: 'road' },
        { text: 'PHƯỜNG PHÚ TÂN', left: 60, top: 20, kind: 'area' },
        { text: 'PHƯỜNG PHÚ KHƯƠNG', left: 84, top: 47, kind: 'area' },
        {
          text: 'Trường Cao Đẳng Bến Tre CS2',
          left: 50,
          top: 14,
          kind: 'place',
        },
        { text: 'Trường Cao Đẳng Bến Tre', left: 30, top: 27, kind: 'place' },
        {
          text: 'Trường CĐ Công Nghệ Đông Khởi',
          left: 38,
          top: 31,
          kind: 'place',
        },
        { text: 'Bến xe Bến Tre', left: 57, top: 24, kind: 'place' },
        { text: 'Bến xe Minh Tâm', left: 86, top: 30, kind: 'place' },
        {
          text: 'BV Đa Khoa Nguyễn Đình Chiểu',
          left: 49,
          top: 75,
          kind: 'place',
        },
        { text: 'Khu Trung Tâm Hành Chính', left: 63, top: 70, kind: 'place' },
        { text: 'TT Thương Mại', left: 65, top: 84, kind: 'place' },
        { text: 'ĐL Hàm Luông', left: 50, top: 89, kind: 'place' },
        { text: 'SÔNG BẾN TRE', left: 80, top: 83, kind: 'area' },
      ],
    },
    items: [
      {
        slug: 'fancy-tower',
        title: 'Chung cư Fancy Tower',
        summary:
          'Tòa căn hộ cao cấp 19 tầng nổi và 1 tầng hầm với 196 căn hộ — dự án chung cư cao tầng đầu tiên tại khu vực.',
        description:
          'Fancy Tower đã được Sở Xây dựng nghiệm thu hoàn thành công trình và sẵn sàng cấp sổ hồng cho cư dân. Tòa nhà đã hoàn thiện thi công, bàn giao và đưa vào vận hành.',
        status: 'DA_BAN_GIAO',
        image:
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-day-01.jpg',
        highlights: [
          '19 tầng nổi, 1 tầng hầm, 196 căn hộ.',
          'Đã nghiệm thu hoàn thành công trình, sẵn sàng cấp sổ hồng.',
          'Hồ bơi và khu tiện ích nội khu đã vận hành.',
        ],
        quickFacts: [
          { label: 'Quy mô', value: '19 tầng nổi + 1 tầng hầm' },
          { label: 'Số căn hộ', value: '196 căn' },
          { label: 'Tình trạng', value: 'Đã bàn giao, đang vận hành' },
        ],
        gallery: [
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-day-01.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-evening-01.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-plaza-01.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-exterior-plaza-02.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-amenity-pool-01.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-amenity-pool-02.jpg',
          '/images/projects/hung-phu/fancy-tower/fancy-tower-amenity-pool-03.jpg',
        ],
      },
      {
        slug: 'hung-phu-mall',
        title: 'Trung tâm thương mại Hưng Phú Mall',
        summary:
          'Trung tâm thương mại 5 tầng trong nội khu, đang hoàn thiện giai đoạn cuối để đưa vào khai thác.',
        status: 'DANG_THI_CONG',
        // Chưa có ảnh chụp riêng của TTTM (đang hoàn thiện) — tạm dùng ảnh phối
        // cảnh tổng thể khu đô thị để thẻ hạng mục không bị trống ảnh.
        // TODO: thay bằng ảnh thật của Hưng Phú Mall khi có.
        image:
          '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-03.jpg',
        quickFacts: [{ label: 'Quy mô', value: '5 tầng' }],
        gallery: [
          '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-03.jpg',
        ],
      },
      {
        slug: 'khu-nha-o-thap-tang',
        title: 'Khu nhà ở thấp tầng',
        summary:
          '330 căn nhà phố liền kề, shophouse đi bộ và biệt thự — đã hoàn thiện, cư dân đã dọn vào sinh sống ổn định.',
        status: 'DA_BAN_GIAO',
        // Ảnh phối cảnh tổng thể (aerial) đã thể hiện rõ khu nhà phố thấp tầng.
        // TODO: bổ sung ảnh chụp thực tế khu nhà ở khi có.
        image:
          '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-02.jpg',
        quickFacts: [{ label: 'Số căn', value: '330 căn' }],
        gallery: [
          '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-02.jpg',
          '/images/projects/hung-phu/master-plan/hung-phu-master-plan-aerial-01.jpg',
        ],
      },
    ],
  },
  {
    slug: 'chung-cu-la-bonita',
    title: 'Chung cư La Bonita',
    summary:
      'Tòa căn hộ 14 tầng với 60 căn hộ trên tuyến đường Nguyễn Gia Trí, Quận Bình Thạnh, TP.HCM.',
    description:
      'La Bonita nằm tại số 6-8 đường Nguyễn Gia Trí (đường D2 cũ), Phường 25, Quận Bình Thạnh. Tòa nhà đã hoàn thiện xây dựng và bàn giao từ năm 2018. Tầng 1-4 là trung tâm thương mại, officetel và văn phòng cho thuê; tầng 5-14 là khu căn hộ.',
    status: 'DA_BAN_GIAO',
    // Địa danh ngắn cho thẻ dự án — địa chỉ đầy đủ nằm ở `quickFacts`.
    location: 'Bình Thạnh, TP.HCM',
    category: 'Chung cư',
    image:
      '/images/projects/la-bonita/building/la-bonita-building-render-01.jpg',
    highlights: [
      'Kết nối trực tiếp ra đường Điện Biên Phủ và Xô Viết Nghệ Tĩnh, 5-10 phút vào trung tâm Quận 1.',
      'Mật độ thoáng: chỉ khoảng 6 căn mỗi sàn.',
      'Sát các trường đại học lớn (Hutech, Ngoại Thương, Giao Thông Vận Tải).',
    ],
    quickFacts: [
      {
        label: 'Địa chỉ',
        value: 'Số 6-8 Nguyễn Gia Trí, Phường 25, Quận Bình Thạnh, TP.HCM',
      },
      { label: 'Diện tích đất', value: '1.374 m²' },
      { label: 'Diện tích sàn xây dựng', value: '11.654 m²' },
      { label: 'Quy mô', value: '1 block, 14 tầng nổi, 2 tầng hầm' },
      { label: 'Số căn hộ', value: '60 căn' },
      { label: 'Bàn giao', value: 'Năm 2018' },
    ],
    gallery: [
      '/images/projects/la-bonita/building/la-bonita-building-render-01.jpg',
      '/images/projects/la-bonita/building/la-bonita-building-render-02.jpg',
    ],
    items: [],
  },
  {
    slug: 'du-an-vung-tau',
    title: 'Silver Sea Tower',
    summary:
      'Tòa nhà phức hợp 18 tầng tại số 47 Ba Cu, trung tâm TP. Vũng Tàu, với 80 căn hộ đã có sổ hồng lâu dài.',
    description:
      'Silver Sea Tower tọa lạc ngay tuyến đường Ba Cu sầm uất, sát cạnh UBND TP. Vũng Tàu, cách Bãi Trước khoảng 500m nên sở hữu tầm nhìn hướng biển ở cả hai mặt tòa nhà. Dự án đã hoàn thiện, bàn giao và đưa vào vận hành đồng bộ cả khối căn hộ lẫn khối văn phòng, thương mại.',
    status: 'DA_BAN_GIAO',
    // Địa danh ngắn cho thẻ dự án — địa chỉ đầy đủ nằm ở `quickFacts`.
    location: 'TP. Vũng Tàu',
    category: 'Chung cư',
    image: '/images/projects/vung-tau/vung-tau-center-exterior-01.webp',
    highlights: [
      'Đã có sổ hồng lâu dài riêng cho từng căn hộ, chuyển nhượng công chứng sang tên bình thường.',
      'Tầng 1-3 trung tâm thương mại, tầng 4-7 văn phòng, tầng 8-18 căn hộ.',
      'Sân vườn trên cao và bãi đáp trực thăng phục vụ công tác PCCC tại tầng áp mái.',
    ],
    quickFacts: [
      {
        label: 'Địa chỉ',
        value: 'Số 47 Ba Cu, Phường 1, TP. Vũng Tàu, tỉnh Bà Rịa - Vũng Tàu',
      },
      { label: 'Diện tích khu đất', value: '1.490,3 m²' },
      { label: 'Quy mô', value: '1 block, 18 tầng nổi, 2 tầng hầm' },
      { label: 'Số căn hộ', value: '80 căn (101 - 162 m², 2-3 phòng ngủ)' },
      {
        label: 'Chủ đầu tư',
        value: 'CTCP Địa ốc Nam Gia phối hợp CTCP Thương mại Tổng hợp BR-VT',
      },
      { label: 'Pháp lý', value: 'Sổ hồng lâu dài từng căn' },
    ],
    gallery: [
      '/images/projects/vung-tau/vung-tau-center-exterior-01.webp',
      '/images/projects/vung-tau/vung-tau-center-exterior-02.webp',
    ],
    items: [],
  },
  {
    slug: 'du-an-bay-hien',
    title: 'Bảy Hiền Tower',
    summary:
      'Tòa nhà 23 tầng tại số 9 Phạm Phú Thứ, Quận Tân Bình, TP.HCM, gồm khối chợ sỉ phụ liệu dệt may và khu căn hộ.',
    description:
      'Bảy Hiền Tower cách Ngã tư Bảy Hiền khoảng 300m, sát vách chợ sỉ Tân Bình. Khối căn hộ đã hoàn thiện và bàn giao, hơn 150 hộ dân đang sinh sống ổn định. Khối thương mại 5 tầng đã xây xong phần thô và đang chờ hoàn tất thủ tục để đưa vào khai thác.',
    // Khối căn hộ đã bàn giao và có cư dân (câu 2 trong CAU-HOI-CAN-XAC-NHAN.md);
    // chỉ khối thương mại còn chờ. Trạng thái cũ `DANG_THI_CONG` gây hiểu nhầm.
    status: 'DA_BAN_GIAO',
    // Địa danh ngắn cho thẻ dự án — địa chỉ đầy đủ nằm ở `quickFacts`.
    location: 'Tân Bình, TP.HCM',
    category: 'Chung cư',
    image: '/images/projects/bay-hien/bay-hien-tower-exterior-01.jpg',
    highlights: [
      'Cách Ngã tư Bảy Hiền khoảng 300m, sát chợ sỉ Tân Bình.',
      '5 tầng khối đế thương mại (~500 sạp chợ sỉ phụ liệu dệt may).',
      'Đối diện Bệnh viện Thống Nhất, gần THPT Nguyễn Thượng Hiền và Công viên Lê Thị Riêng.',
    ],
    quickFacts: [
      {
        label: 'Địa chỉ',
        value: 'Số 9 Phạm Phú Thứ, Phường 11, Quận Tân Bình, TP.HCM',
      },
      { label: 'Diện tích khu đất', value: '2.712 m²' },
      { label: 'Quy mô', value: '23 tầng nổi, 2 tầng hầm (hầm ~5.500 m²)' },
      { label: 'Số căn hộ', value: '168 - 196 căn (70 - 101 m² và Duplex)' },
      { label: 'Pháp lý', value: 'Chưa cấp sổ hồng, đang xử lý gỡ vướng' },
    ],
    gallery: ['/images/projects/bay-hien/bay-hien-tower-exterior-01.jpg'],
    items: [],
  },
];

/** Ảnh gallery seed lại từ đầu mỗi lần chạy — tránh nhân bản khi chạy lặp. */
async function seedGallery(client, projectId, projectItemId, urls) {
  for (const [order, url] of urls.entries()) {
    await client.query(
      `INSERT INTO project_gallery (id, project_id, project_item_id, url, "order", created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`,
      [projectId, projectItemId, url, order],
    );
  }
}

async function main() {
  const useSsl = /\brender\.com\b/.test(process.env.DATABASE_URL ?? '');

  // `.env` của máy dev đang trỏ vào Render (production). Seed ghi đè nội dung
  // dự án nên phải xác nhận có chủ ý, không để lỡ tay chạy nhầm.
  if (useSsl && process.env.SEED_CONFIRM_PRODUCTION !== 'yes') {
    throw new Error(
      'DATABASE_URL đang trỏ vào production (Render). Chạy lại với ' +
        'SEED_CONFIRM_PRODUCTION=yes nếu thực sự muốn seed production.',
    );
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  for (const [order, project] of projects.entries()) {
    const res = await client.query(
      `INSERT INTO projects
         (id, slug, title, summary, description, status, content_status, location,
          image, gallery, category, highlights, quick_facts, gallery_sections,
          map_location, "order", created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::"ProjectStatus", 'PUBLISHED', $6,
               $7, $8, $9, $10, $11, $12, $13, $14, now(), now())
       ON CONFLICT (slug) DO UPDATE
         SET title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             description = EXCLUDED.description,
             status = EXCLUDED.status,
             content_status = EXCLUDED.content_status,
             location = EXCLUDED.location,
             image = EXCLUDED.image,
             gallery = EXCLUDED.gallery,
             category = EXCLUDED.category,
             highlights = EXCLUDED.highlights,
             quick_facts = EXCLUDED.quick_facts,
             gallery_sections = EXCLUDED.gallery_sections,
             map_location = EXCLUDED.map_location,
             "order" = EXCLUDED."order",
             updated_at = now()
       RETURNING id`,
      [
        project.slug,
        vi(project.title),
        vi(project.summary),
        project.description ? vi(project.description) : null,
        project.status,
        bilingual(project.location),
        project.image ?? null,
        project.gallery ?? [],
        bilingual(project.category),
        localizedList(project.highlights),
        JSON.stringify(project.quickFacts ?? []),
        project.gallerySections
          ? JSON.stringify(project.gallerySections)
          : null,
        project.mapLocation ? JSON.stringify(project.mapLocation) : null,
        order,
      ],
    );
    const projectId = res.rows[0].id;

    // Xóa ảnh cũ trước khi seed lại (gallery không có ràng buộc duy nhất).
    await client.query('DELETE FROM project_gallery WHERE project_id = $1', [
      projectId,
    ]);
    await seedGallery(client, projectId, null, project.gallery ?? []);

    for (const [itemOrder, item] of (project.items ?? []).entries()) {
      const itemRes = await client.query(
        `INSERT INTO project_items
           (id, project_id, slug, title, summary, description, status, image,
            highlights, quick_facts, gallery_sections, "order", created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::"ProjectStatus", $7, $8, $9, $10, $11, now(), now())
         ON CONFLICT (project_id, slug) DO UPDATE
           SET title = EXCLUDED.title,
               summary = EXCLUDED.summary,
               description = EXCLUDED.description,
               status = EXCLUDED.status,
               image = EXCLUDED.image,
               highlights = EXCLUDED.highlights,
               quick_facts = EXCLUDED.quick_facts,
               gallery_sections = EXCLUDED.gallery_sections,
               "order" = EXCLUDED."order",
               updated_at = now()
         RETURNING id`,
        [
          projectId,
          item.slug,
          vi(item.title),
          item.summary ? vi(item.summary) : null,
          item.description ? vi(item.description) : null,
          item.status ?? null,
          item.image ?? null,
          localizedList(item.highlights),
          JSON.stringify(item.quickFacts ?? []),
          item.gallerySections ? JSON.stringify(item.gallerySections) : null,
          itemOrder,
        ],
      );
      await seedGallery(
        client,
        projectId,
        itemRes.rows[0].id,
        item.gallery ?? [],
      );
    }

    const itemCount = (project.items ?? []).length;
    console.log(
      `✅ ${project.title} — ${(project.gallery ?? []).length} ảnh, ${itemCount} hạng mục`,
    );
  }

  await client.end();
  console.log(`\n✅ Đã seed ${projects.length} dự án.`);
}

main().catch((error) => {
  console.error(
    '❌ Seed dự án thất bại:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
