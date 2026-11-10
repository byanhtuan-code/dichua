# Nguồn asset

Mọi asset trong thư mục này đều có giấy phép mở.
Asset chỉ dùng loại giấy phép mở.

| File | Nguồn | Tác giả | Giấy phép | Đã sửa |
| --- | --- | --- | --- | --- |
| `models/buddha.glb` | Bảo tàng Quốc gia Hàn Quốc, 금동불좌상·금동보살입상 (덕수2116), tượng ngồi `duk002116_002` — https://www.museum.go.kr/afile/fileDownloadById/31664 | 국립중앙박물관 (National Museum of Korea) | KOGL Loại 1 (ghi nguồn) — https://www.kogl.or.kr/info/licenseType1.do | OBJ → GLB (obj2gltf), giảm 73k → 30k tam giác, texture màu + normal 8192 → 2048 WebP, nén meshopt, gốc toạ độ ở đáy giữa tượng |
| `models/pine.glb` | Poly Haven — Pine Sapling Small — https://polyhaven.com/a/pine_sapling_small | Poly Haven | CC0 | Bản 1k, giảm lưới (~35k tam giác cho 3 biến thể), texture WebP 1024, nén meshopt, gốc ở đáy |
| `env/woodland.jpg` | Poly Haven — Forest Slope (HDRI, bản JPG tonemapped) — https://polyhaven.com/a/forest_slope | Poly Haven | CC0 | Thu 2048×1024, JPEG chất lượng 72 |
| `materials/wood/*` | Poly Haven — Wood Planks — https://polyhaven.com/a/wood_planks | Poly Haven | CC0 | Bản 1k (diff / nor_gl / rough), JPEG 72 |
| `materials/roof/*` | Poly Haven — Grey Roof Tiles — https://polyhaven.com/a/grey_roof_tiles | Poly Haven | CC0 | như trên |
| `materials/plaster/*` | Poly Haven — Clay Plaster — https://polyhaven.com/a/clay_plaster | Poly Haven | CC0 | như trên |
| `materials/stone/*` | Poly Haven — Cobblestone 01 — https://polyhaven.com/a/cobblestone_01 | Poly Haven | CC0 | như trên |
| `materials/ground/*` | Poly Haven — Brown Mud Leaves 01 — https://polyhaven.com/a/brown_mud_leaves_01 | Poly Haven | CC0 | như trên |
| `materials/cloth/*` | Poly Haven — Rough Linen — https://polyhaven.com/a/rough_linen | Poly Haven | CC0 | như trên |
| `../audio/chant.mp3` | 한국저작권위원회 공유마당 (Gongu) — 염불소리1 (UCI G905-13254274) — https://gongu.copyright.or.kr/gongu/wrt/wrt/view.do?wrtSn=13254274&menuNo=200020 | 김용배 (Kim Yong-bae) | CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ | WAV 48 kHz stereo → MP3 mono 96 kbps (ffmpeg), 119 s, phát lặp |
| âm nền, chuông, tiếng hạt | **procedural** — tổng hợp bằng Web Audio (T12) | Sân Tĩnh | — | — |
| mural (tranh tường) | **procedural** — vẽ bằng code (CanvasTexture, T5) | Sân Tĩnh | — | Không tìm được tranh Phật giáo phạm vi công cộng khổ ngang 2:1 có hào quang ở giữa (P-D9) |

Bản `normal.jpg` là chuẩn OpenGL (Y+), dùng thẳng cho `MeshStandardMaterial.normalMap`.
