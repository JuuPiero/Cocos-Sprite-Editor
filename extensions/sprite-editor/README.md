# Sprite Editor cho Cocos Creator 3.8

Cắt một spritesheet thành nhiều SpriteFrame giống **Sprite Mode: Multiple + Sprite Editor** của Unity.

Kết quả lưu thành `<tên ảnh>.plist` đặt cạnh ảnh. Cocos đọc file này như một **SpriteAtlas gốc**, nên mỗi sprite đã cắt là một SpriteFrame thật:

- kéo thẳng vào `Sprite.spriteFrame`, Animation Clip, Prefab…
- có trong build, load runtime bằng `atlas.getSpriteFrame(name)`
- Pivot và Border (9-slice) được ghi vào meta của từng SpriteFrame

Extension là một package hoàn chỉnh: `dist/` đã bundle sẵn Vue nên không cần `npm install` để dùng, và code runtime nằm trong `assets/` (mount thành `db://sprite-editor`).

## Mở editor

- Chuột phải ảnh (hoặc file `.plist`) trong **Assets** → **Sprite Editor**
- Hoặc **Panel → Sprite Editor**, rồi chọn ảnh trong Assets. Editor tự đi theo vùng chọn, giống Unity.

## Thao tác (giống Unity)

| Thao tác | Cách làm |
| --- | --- |
| Tạo sprite | Kéo chuột trên vùng trống |
| Chọn / chọn thêm | Click / Shift+click |
| Di chuyển | Kéo trong khung, hoặc phím mũi tên (Shift = 10px) |
| Đổi kích thước | Kéo 8 ô vuông xanh ở góc/cạnh, hoặc mép ngoài khung |
| Border 9-slice | Kéo mép **trong** khung (đường xanh lá) |
| Pivot | Kéo chấm tròn xanh (giữ Ctrl để bắt vào 0 / 0.5 / 1) |
| Zoom / di chuyển view | Lăn chuột / chuột giữa, chuột phải, Alt+kéo hoặc Space+kéo |
| Canh khung | `F` (vùng chọn), `0` hoặc Home (cả ảnh), double-click thanh zoom |
| Xóa | `Delete` |
| Hoàn tác | `Ctrl+Z`, `Ctrl+Y` / `Ctrl+Shift+Z` |
| Lưu | **Apply** hoặc `Ctrl+S`. **Revert** để bỏ thay đổi |

Nút ◐ trên toolbar hiện kênh alpha. Có thể kéo nhãn `X`, `Y`, `W`… trong ô Sprite để chỉnh số như Unity.

### Slice

- **Automatic**: tự tìm từng cụm pixel. Ảnh trong suốt dùng alpha, ảnh có nền màu dùng màu ở 4 góc (Background = Color).
  - *Minimum Size*: bỏ đốm nhỏ
  - *Merge Distance*: gộp các phần gần nhau thành một sprite
  - *Separate*: tách hai sprite dính nhau bởi nét mảnh
  - *Extrude Size*: nới rộng khung
- **Grid By Cell Size / Grid By Cell Count**: cắt theo lưới, có Offset, Padding và *Keep Empty Rects*. Khi popup Slice đang mở, lưới hiện trước trên ảnh.
- **Method**:
  - *Delete Existing*: thay toàn bộ khung
  - *Smart*: cập nhật khung trùng vị trí và giữ tên, pivot, border (nên dùng khi sprite đã được dùng ở nơi khác)
  - *Safe*: chỉ thêm khung không chồng lên khung cũ

## Dùng trong game

```ts
import { Sprite, SpriteAtlas } from 'cc';
import { SpriteSheet } from 'db://sprite-editor/SpriteSheet';

// Kéo thẳng SpriteFrame trong Inspector, hoặc trong code:
const atlas = await SpriteSheet.load('sheets/hero');      // resources/sheets/hero.plist
sprite.spriteFrame = atlas.getSpriteFrame('hero_0');
const run = SpriteSheet.getFrames(atlas, 'hero_run');      // hero_run_0, hero_run_1, … (thứ tự tự nhiên)
```

Component (Add Component → **SpriteSheet**):

- **SpritePivot**: đặt `anchorPoint` của node theo Pivot đã chỉnh trong Sprite Editor, kể cả khi animation đổi frame. Nhờ đó các frame canh đúng điểm pivot như Unity. Không cần cho `SpriteRenderer` vì nó dùng pivot sẵn.
- **SpriteSheetAnimation**: phát animation theo frame. Mỗi clip có thể là danh sách frame hoặc *Atlas + Prefix*. Có `play(name)`, `stop()`, `pause()`, `resume()`, `setFrame(i)`, `addClip(...)`, và các event `FINISHED`, `LOOP`, `FRAME`. Dùng được cho cả `Sprite` lẫn `SpriteRenderer`.

Cũng có thể dùng Animation editor của Cocos: kéo nhiều SpriteFrame vào track `spriteFrame`.

## Lưu ý

- **Đổi tên hoặc xóa sprite làm đổi UUID của SpriteFrame đó.** Scene/Prefab đang dùng nó sẽ mất tham chiếu; editor sẽ hỏi lại trước khi Apply. Muốn cắt lại mà giữ tham chiếu, hãy dùng Method **Smart**.
- Toạ độ X/Y trong ô Sprite tính từ **góc trên-trái** của ảnh. Pivot tính từ góc dưới-trái, giống Unity.
- `.plist` có frame bị xoay (TexturePacker bật *Allow rotation*) chỉ mở được ở chế độ xem.
- Ảnh pixel art: chọn texture của ảnh → Filter Mode = `nearest`.

## Phát triển

```bash
npm install
npm run build      # tsc (kiểm tra type) + esbuild → dist/
npm run watch      # build lại khi sửa
npm test           # unit test slicer + plist
npm run preview    # build tests/preview/out/preview.html: chạy UI trong trình duyệt
```

Mở `tests/preview/out/preview.html#interact` để chạy bộ test thao tác chuột/phím. Các trạng thái khác: `#selected`, `#slice`, `#multi`, `#readonly`, `#empty`.

Sau khi build, vào **Extension → Extension Manager**, bấm refresh extension (hoặc khởi động lại Creator).

| Thư mục | Nội dung |
| --- | --- |
| `source/core` | slicer (tách sprite), plist (đọc/ghi atlas), editor-bridge (asset-db) |
| `source/panels/default` | Vue app, store (state, undo, slice, apply), viewport (canvas) |
| `static/` | template + CSS của panel |
| `assets/` | code runtime: `SpriteSheet`, `SpritePivot`, `SpriteSheetAnimation` |
