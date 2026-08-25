import { ContentStatus } from '../../generated/prisma/client';
import {
  clearedSchedule,
  editorMayEditScheduled,
  hasBeenPublic,
  hasHistoricalPublication,
  isActiveFutureSchedule,
  publishedAtFor,
  type ScheduleState,
} from './publication-schedule';

/**
 * Test TRỰC TIẾP cho các vị từ lịch đăng dùng chung — nguồn sự thật của **cả
 * bốn** module: News, Project, Page, Cooperation.
 *
 * Trước batch này file `publication-schedule.ts` chỉ được phủ **gián tiếp** qua
 * spec của từng service. Phủ gián tiếp bỏ lọt đúng thứ nguy hiểm nhất: một lần
 * "đơn giản hoá" helper có thể vẫn để service spec xanh ở những tổ hợp mà từng
 * module tình cờ không dựng, rồi đổi hành vi của ba module còn lại.
 *
 * Thứ file này khoá chặt nhất là phép so **`publishedAt === scheduledAt`** —
 * ranh giới giữa một *dự định* chưa xảy ra và một *lần công khai đã xảy ra*.
 * Xem describe cuối file.
 */

/** Mốc "bây giờ" cố định — mọi test truyền `now` tường minh, không đọc đồng hồ thật. */
const NOW = new Date('2026-06-15T08:00:00.000Z');
const PAST = new Date('2026-01-01T00:00:00.000Z');
const FUTURE = new Date('2026-12-31T00:00:00.000Z');

/** Dựng `ScheduleState` gọn cho từng ca. */
function state(
  contentStatus: ContentStatus,
  scheduledAt: Date | null,
  publishedAt: Date | null,
): ScheduleState {
  return { contentStatus, scheduledAt, publishedAt };
}

/**
 * Bản ghi đang giữ **lịch tương lai hợp lệ**: đúng bất biến mà lệnh đặt lịch
 * ghi ra — `PENDING`, `scheduledAt` ở tương lai, và `publishedAt` **đúng bằng**
 * `scheduledAt`. Dùng lại ở nhiều describe nên dựng bằng hàm để mỗi ca có
 * instance `Date` riêng (chứng minh hợp đồng là so **giá trị**, không phải so
 * tham chiếu).
 */
function activeFutureSchedule(): ScheduleState {
  return state(
    ContentStatus.PENDING,
    new Date(FUTURE),
    new Date(FUTURE), // publishedAt === scheduledAt — mốc "đặt chỗ", chưa xảy ra
  );
}

describe('publication-schedule — vị từ lịch đăng dùng chung', () => {
  // -------------------------------------------------------------- hasBeenPublic
  describe('hasBeenPublic — đã THẬT SỰ ra công khai chưa', () => {
    it('chưa có mốc nào thì chưa từng công khai', () => {
      expect(hasBeenPublic({ publishedAt: null }, NOW)).toBe(false);
    });

    it('mốc nằm ở quá khứ nghĩa là đã ra công khai', () => {
      expect(hasBeenPublic({ publishedAt: PAST }, NOW)).toBe(true);
    });

    it('mốc đúng bằng `now` đã tính là công khai (biên là <=)', () => {
      expect(hasBeenPublic({ publishedAt: new Date(NOW) }, NOW)).toBe(true);
    });

    it('KHÔNG chỉ là "publishedAt != null": mốc ở TƯƠNG LAI là chỗ đặt lịch, chưa công khai', () => {
      // Đây là lý do vị từ này mạnh hơn phép kiểm null. Lệnh đặt lịch ghi
      // `publishedAt = scheduledAt` ở tương lai; coi mốc đó là "đã công khai"
      // sẽ làm "Trả về nháp" giữ lại một mốc chưa bao giờ xảy ra.
      expect(hasBeenPublic({ publishedAt: FUTURE }, NOW)).toBe(false);
    });
  });

  // ------------------------------------------------------ isActiveFutureSchedule
  describe('isActiveFutureSchedule — lịch tương lai còn hiệu lực', () => {
    it('đủ cả bốn điều kiện thì là lịch hợp lệ (đổi được, huỷ được)', () => {
      expect(isActiveFutureSchedule(activeFutureSchedule(), NOW)).toBe(true);
    });

    it('không phải PENDING thì không phải lịch đang chờ', () => {
      expect(
        isActiveFutureSchedule(state(ContentStatus.DRAFT, FUTURE, FUTURE), NOW),
      ).toBe(false);
      expect(
        isActiveFutureSchedule(
          state(ContentStatus.PUBLISHED, FUTURE, FUTURE),
          NOW,
        ),
      ).toBe(false);
    });

    it('thiếu `scheduledAt` hoặc thiếu `publishedAt` đều không phải lịch hợp lệ', () => {
      expect(
        isActiveFutureSchedule(state(ContentStatus.PENDING, null, FUTURE), NOW),
      ).toBe(false);
      expect(
        isActiveFutureSchedule(state(ContentStatus.PENDING, FUTURE, null), NOW),
      ).toBe(false);
    });

    it('lịch ĐÃ TỚI HẠN không còn là lịch tương lai — biên là > nghiêm ngặt', () => {
      // `scheduledAt === now` là ca biên quan trọng: nội dung đã đủ điều kiện
      // hiển thị công khai (vị từ hiển thị cho nó ra), nên không được coi là
      // một dự định còn huỷ/đổi được nữa.
      const due = state(ContentStatus.PENDING, new Date(NOW), new Date(NOW));
      expect(isActiveFutureSchedule(due, NOW)).toBe(false);
    });

    it('lịch đã quá hạn cũng không còn hiệu lực', () => {
      expect(
        isActiveFutureSchedule(state(ContentStatus.PENDING, PAST, PAST), NOW),
      ).toBe(false);
    });

    it('`publishedAt` KHÁC `scheduledAt` thì không phải lịch do lệnh đặt lịch ghi ra', () => {
      // Bài từng đăng năm cũ rồi bị gán thêm một lịch tương lai: mốc kia là
      // lịch sử thật, không phải dự định. Coi nhầm là lịch hợp lệ thì nhánh
      // huỷ lịch sẽ xoá mất mốc lịch sử đó.
      expect(
        isActiveFutureSchedule(state(ContentStatus.PENDING, FUTURE, PAST), NOW),
      ).toBe(false);
    });
  });

  // --------------------------------------------------- hasHistoricalPublication
  describe('hasHistoricalPublication — đã có lịch sử xuất bản thật', () => {
    it('chưa có mốc nào thì chưa có lịch sử', () => {
      expect(
        hasHistoricalPublication(state(ContentStatus.DRAFT, null, null), NOW),
      ).toBe(false);
    });

    it('bản đang đăng có lịch sử xuất bản', () => {
      expect(
        hasHistoricalPublication(
          state(ContentStatus.PUBLISHED, null, PAST),
          NOW,
        ),
      ).toBe(true);
    });

    it('nháp TỪNG đăng vẫn có lịch sử — không rút gọn về mỗi `status`', () => {
      // `status = DRAFT` một mình nói SAI: nội dung đã ra ngoài, đã được index.
      expect(
        hasHistoricalPublication(state(ContentStatus.DRAFT, null, PAST), NOW),
      ).toBe(true);
    });

    it('PENDING mang mốc quá khứ cũng là lịch sử thật', () => {
      expect(
        hasHistoricalPublication(state(ContentStatus.PENDING, null, PAST), NOW),
      ).toBe(true);
    });

    it('lịch tương lai đang chờ KHÔNG phải lịch sử — dự định chưa xảy ra', () => {
      expect(hasHistoricalPublication(activeFutureSchedule(), NOW)).toBe(false);
    });

    it('lịch đã tới hạn ĐƯỢC tính là lịch sử — nội dung đã hiển thị công khai', () => {
      const due = state(ContentStatus.PENDING, new Date(NOW), new Date(NOW));
      expect(hasHistoricalPublication(due, NOW)).toBe(true);
    });
  });

  // ---------------------------------------------------- editorMayEditScheduled
  describe('editorMayEditScheduled — ma trận quyền sửa của EDITOR', () => {
    it('A. nháp chưa từng công khai: SỬA ĐƯỢC', () => {
      expect(
        editorMayEditScheduled(state(ContentStatus.DRAFT, null, null)),
      ).toBe(true);
    });

    it('B. chờ duyệt, CHƯA hẹn giờ: SỬA ĐƯỢC — chưa ai duyệt gì để mà phá vỡ', () => {
      expect(
        editorMayEditScheduled(state(ContentStatus.PENDING, null, null)),
      ).toBe(true);
    });

    it('C. đã hẹn lịch tương lai: CHẶN', () => {
      expect(editorMayEditScheduled(activeFutureSchedule())).toBe(false);
    });

    it('D. lịch đã tới hạn, reconciler chưa chạy: CHẶN', () => {
      // Chính là lỗ hổng 07:59 — bản ADMIN đã uỷ quyền cho một lần đăng.
      const due = state(ContentStatus.PENDING, new Date(NOW), new Date(NOW));
      expect(editorMayEditScheduled(due)).toBe(false);
    });

    it('E. đang đăng công khai: CHẶN', () => {
      expect(
        editorMayEditScheduled(state(ContentStatus.PUBLISHED, null, PAST)),
      ).toBe(false);
    });

    it('F. nháp TỪNG đăng: CHẶN — không "hồi sinh" quyền sửa chỉ vì status là DRAFT', () => {
      expect(
        editorMayEditScheduled(state(ContentStatus.DRAFT, null, PAST)),
      ).toBe(false);
    });

    it('G. PENDING mang mốc lịch sử: CHẶN', () => {
      expect(
        editorMayEditScheduled(state(ContentStatus.PENDING, null, PAST)),
      ).toBe(false);
    });

    it('dữ liệu dị dạng — PUBLISHED mà thiếu mốc công khai: CHẶN (fail closed)', () => {
      expect(
        editorMayEditScheduled(state(ContentStatus.PUBLISHED, null, null)),
      ).toBe(false);
    });

    it('PENDING + `scheduledAt` mà thiếu `publishedAt`: CHẶN nhờ lớp chốt thứ hai', () => {
      // Vế `scheduledAt === null` tồn tại đúng cho ca dữ liệu cũ thiếu mốc.
      expect(
        editorMayEditScheduled(state(ContentStatus.PENDING, FUTURE, null)),
      ).toBe(false);
    });

    // Ghi chú hợp đồng: vị từ này KHÔNG nhận `now` (TypeScript ép sẵn), vì nó
    // chỉ đọc *sự tồn tại* của mốc. Nhờ vậy bất biến "lịch đã đặt thì EDITOR
    // không sửa được" đúng ở cả trước hạn, đúng hạn lẫn sau hạn mà cron chưa
    // chạy — ca C và D bên trên chứng minh đúng điều đó bằng cùng một câu trả
    // lời cho hai bản ghi chỉ khác nhau ở chỗ đã tới hạn hay chưa.
  });

  // --------------------------------------------------------- clearedSchedule
  describe('clearedSchedule — dọn `scheduledAt` khi đổi trạng thái thủ công', () => {
    it('sang PUBLISHED: xoá lịch (null)', () => {
      expect(clearedSchedule(ContentStatus.PUBLISHED)).toBeNull();
    });

    it('sang DRAFT: xoá lịch (null) — chặn reconciler tự đăng lại', () => {
      expect(clearedSchedule(ContentStatus.DRAFT)).toBeNull();
    });

    it('sang PENDING: KHÔNG đụng tới cột (undefined), vì PENDING + scheduledAt CHÍNH LÀ trạng thái đã lên lịch', () => {
      expect(clearedSchedule(ContentStatus.PENDING)).toBeUndefined();
    });

    it('`undefined` và `null` KHÔNG thay thế cho nhau được ở Prisma', () => {
      // `null` ghi NULL xuống cột; `undefined` bỏ cột khỏi câu UPDATE. Đổi
      // nhánh PENDING thành `null` sẽ âm thầm huỷ lịch mỗi lần ADMIN chuyển
      // nội dung về hàng chờ duyệt.
      expect(clearedSchedule(ContentStatus.PENDING)).not.toBeNull();
      expect(clearedSchedule(ContentStatus.DRAFT)).not.toBeUndefined();
    });
  });

  // ---------------------------------------------------------- publishedAtFor
  describe('publishedAtFor — mốc công khai cho một lần đổi trạng thái thủ công', () => {
    describe('sang PUBLISHED', () => {
      it('nội dung chưa từng có mốc nào: lấy `now`', () => {
        expect(
          publishedAtFor({ publishedAt: null }, ContentStatus.PUBLISHED, NOW),
        ).toBe(NOW);
      });

      it('đăng LẠI nội dung từng công khai thật: GIỮ mốc lịch sử', () => {
        // Thứ tự trang tin không được nhảy lung tung sau mỗi lần sửa rồi đăng lại.
        const result = publishedAtFor(
          { publishedAt: PAST },
          ContentStatus.PUBLISHED,
          NOW,
        );
        expect(result).not.toBeNull();
        expect((result as Date).getTime()).toBe(PAST.getTime());
      });

      it('"Đăng ngay" một bản đang hẹn lịch: lấy `now`, KHÔNG giữ mốc tương lai', () => {
        // Nếu giữ mốc đã đặt chỗ thì nội dung vừa bấm đăng lại mang mốc công
        // khai nằm ở ngày mai: danh sách sắp sai, sitemap khai `lastModified`
        // ở tương lai, JSON-LD nói xuất bản vào một ngày chưa đến.
        const result = publishedAtFor(
          { publishedAt: FUTURE },
          ContentStatus.PUBLISHED,
          NOW,
        );
        expect(result).toBe(NOW);
        expect((result as Date).getTime()).not.toBe(FUTURE.getTime());
      });
    });

    describe('sang DRAFT', () => {
      it('nội dung chưa từng công khai: xoá mốc (null)', () => {
        expect(
          publishedAtFor({ publishedAt: null }, ContentStatus.DRAFT, NOW),
        ).toBeNull();
      });

      it('huỷ một lịch chưa xảy ra: XOÁ mốc — đó mới chỉ là ý định', () => {
        expect(
          publishedAtFor({ publishedAt: FUTURE }, ContentStatus.DRAFT, NOW),
        ).toBeNull();
      });

      it('gỡ nội dung ĐÃ công khai: GIỮ mốc — xoá đi là xoá mất sự thật đã xảy ra', () => {
        const result = publishedAtFor(
          { publishedAt: PAST },
          ContentStatus.DRAFT,
          NOW,
        );
        expect(result).not.toBeNull();
        expect((result as Date).getTime()).toBe(PAST.getTime());
      });

      it('mốc đúng bằng `now` được coi là đã công khai nên GIỮ lại (biên <=)', () => {
        const atNow = new Date(NOW);
        const result = publishedAtFor(
          { publishedAt: atNow },
          ContentStatus.DRAFT,
          NOW,
        );
        expect((result as Date).getTime()).toBe(NOW.getTime());
      });
    });

    describe('sang PENDING', () => {
      it('KHÔNG đụng tới mốc công khai, ở cả ba dạng dữ liệu', () => {
        expect(
          publishedAtFor({ publishedAt: null }, ContentStatus.PENDING, NOW),
        ).toBeNull();

        const historical = publishedAtFor(
          { publishedAt: PAST },
          ContentStatus.PENDING,
          NOW,
        );
        expect((historical as Date).getTime()).toBe(PAST.getTime());

        const reserved = publishedAtFor(
          { publishedAt: FUTURE },
          ContentStatus.PENDING,
          NOW,
        );
        expect((reserved as Date).getTime()).toBe(FUTURE.getTime());
      });
    });
  });

  // ------------------------------------------- hồi quy: publishedAt === scheduledAt
  /**
   * Ca tinh tế nhất của cả cơ chế, tách riêng vì nó là thứ dễ bị "đơn giản hoá"
   * nhất trong tương lai.
   *
   * Lệnh đặt lịch ghi **nguyên tử** `publishedAt = scheduledAt`, nên một bản ghi
   * đang hẹn giờ và một bản ghi từng đăng thật TRÔNG GIỐNG NHAU nếu chỉ nhìn
   * `publishedAt != null`. Thứ phân biệt hai bên là phép **so bằng** giữa hai
   * mốc, cộng với việc mốc đó còn nằm ở tương lai hay không.
   *
   * Nếu ai đó rút gọn thành `publishedAt !== null ⇒ đã có lịch sử xuất bản`:
   * huỷ lịch sẽ bị từ chối oan, và "Đăng ngay" một bản đang hẹn giờ sẽ mang mốc
   * công khai nằm ở tương lai. Các expect dưới đây sẽ đỏ trước khi điều đó lọt
   * ra production.
   */
  describe('hồi quy: mốc ĐẶT CHỖ (publishedAt === scheduledAt) khác mốc LỊCH SỬ', () => {
    it('mốc đặt chỗ KHÔNG được coi là đã công khai, dù `publishedAt != null`', () => {
      const reserved = activeFutureSchedule();

      expect(reserved.publishedAt).not.toBeNull();
      expect(reserved.publishedAt?.getTime()).toBe(
        reserved.scheduledAt?.getTime(),
      );

      // Ba vị từ phải cùng nói "chưa xảy ra":
      expect(hasBeenPublic(reserved, NOW)).toBe(false);
      expect(isActiveFutureSchedule(reserved, NOW)).toBe(true);
      expect(hasHistoricalPublication(reserved, NOW)).toBe(false);
    });

    it('cùng hai mốc bằng nhau nhưng ĐÃ tới hạn thì là lịch sử, không còn là dự định', () => {
      const due = state(ContentStatus.PENDING, new Date(NOW), new Date(NOW));

      expect(due.publishedAt?.getTime()).toBe(due.scheduledAt?.getTime());
      expect(isActiveFutureSchedule(due, NOW)).toBe(false);
      expect(hasHistoricalPublication(due, NOW)).toBe(true);
    });

    it('hai mốc KHÁC nhau ở tương lai là lịch sử thật, không phải chỗ đặt lịch', () => {
      const historicalPlusSchedule = state(ContentStatus.PENDING, FUTURE, PAST);

      expect(isActiveFutureSchedule(historicalPlusSchedule, NOW)).toBe(false);
      expect(hasHistoricalPublication(historicalPlusSchedule, NOW)).toBe(true);
    });

    it('so theo GIÁ TRỊ chứ không theo tham chiếu Date', () => {
      // Hai instance `Date` khác nhau, cùng giá trị — hợp đồng phải coi là bằng.
      const instant = FUTURE.getTime();
      const reserved = state(
        ContentStatus.PENDING,
        new Date(instant),
        new Date(instant),
      );
      expect(reserved.scheduledAt).not.toBe(reserved.publishedAt);
      expect(isActiveFutureSchedule(reserved, NOW)).toBe(true);
    });
  });
});
