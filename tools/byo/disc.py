#!/usr/bin/env python3
"""disc.py -- check a Dirge of Cerberus disc image and pull the two files the build needs.

Bring-your-own-disc helper for tools/byo/build_web.sh. Reads the ISO 9660 image directly
(no mounting, no 7-Zip), so it needs nothing but Python 3.

  python3 -I tools/byo/disc.py check   <image.iso>            disc id + file hashes
  python3 -I tools/byo/disc.py extract <image.iso> <workdir>  FILELIST.BIN + KEL.DAT -> workdir
  python3 -I tools/byo/disc.py elf     <image.iso> <dst>      the ELF (SLES_541.85) -> dst, hash-checked
  python3 -I tools/byo/disc.py verify  <noPath dir>           the unpacked inputs the build reads
  python3 -I tools/byo/disc.py isohash <image.iso>            sha256 of the whole image (slow)

Supported disc: PAL SLES-54185, "Dirge of Cerberus: Final Fantasy VII" (Europe, Australia)
(En,Fr,De,Es,It). The check is on the files inside the image (boot id + SHA-256 of
SYSTEM.CNF, the ELF, FILELIST.BIN and KEL.DAT), not on the image as a whole, so a rip
that differs only in padding still passes. The whole-image hash of the reference image is
in REFERENCE_ISO_SHA256 (Redump-style rip, 4,188,471,296 bytes) for comparison.

Everything this writes is game data: keep it in gitignored places (the build script uses
<repo>/extract/, which .gitignore excludes). Exit status: 0 ok, 1 wrong/damaged disc, 2 usage.
"""
import hashlib, os, struct, sys

SECTOR = 2048
BOOT_ID = 'SLES_541.85'
REFERENCE_ISO_SHA256 = '0b29c6f7947fa6fa3fa1c363fe224856d89b1451c0a561ff63dc7709b39b6e3c'
REFERENCE_ISO_SIZE = 4188471296
# SHA-256 of the files inside the supported disc (hashes are not game data).
KNOWN = {
    'SYSTEM.CNF': '2a524ce9bb4d48258721b92e54727d2d32af52a89db48b948304760e650bfb25',
    'SLES_541.85': 'd51e59218891b61db4438824e04dcb8e19fe8468c7e034b2375856f771c21012',
    'FILELIST.BIN': '6ec5b671f107df1249305a52326a6e8c5c737ba675b66164153dd8858655b850',
    'E419C51B/KEL.DAT': '7ce51b07f2e218a1ba734c379276ec08a73197d3db337158c897cca35303d9cc',
}
# The unpacked files (extract/_KEL/noPath) the web build reads, with their SHA-256: every
# file whose access time moved during a build of the reference disc in a fresh clone
# (2026-10-26). Add new inputs here when an exporter starts reading another file.
INPUTS = {
    '06800001.bin': 'a16d8406cfa107c3517c24642c2c156ffcb378a3d7153f21e70912333cc10eba',
    # chunk animation files (UV scroll; export_z128_room.py via bmd_uvanim.py, worker 0226)
    '06800010.bin': '35048909fcd0cbaf8033e5d1b9fa88beb63c07ddc6e5ba0921b8905ac5eecd18',
    '06800110.bin': '4b10a37484a0fb10c461e52245767bf15860b2f5932bf66f1527422f12f5c545',
    '06800210.bin': '843668fb34ff9198d8ff870722120e9fb29442c9ee3d26c4492ccbf053e75d2a',
    '06800310.bin': '27c441ab950132274f71ec23630a1b901aeb8eea5f34fcbabee5147c4d557e68',
    '06800410.bin': '61220bd7a3bee3181350434aa1724c7f354a8c348cf53f74703ca7d930fa181d',
    '06800510.bin': 'dff3141be791e304481ebe1dea715c6e4de1887fc0bed388e47e71834fdc4472',
    '06800610.bin': '0706ce70a14a427fbbfebbfee7862d3002709d643a3b35ef1cb62d91508ef1dc',
    '06800710.bin': '2bf3a0b70873c02595f99243143d74afc084c0ab0046dbc2473b67be6172d13f',
    '06800810.bin': 'cfea49b1283194563fc0e0e955c025d7366f5319b3b179d2745569c9c17e7840',
    '06800910.bin': '0a2653f93327955bac8922862cceea919691b325f347b686e1ffc8c2c6c72aa8',
    '06800a10.bin': 'df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119',
    '06800b10.bin': '820170e9c045ceca9de4f70bb6aa8ac51e0e4ff73bf97f1812f6b6f37bb16243',
    '06800c10.bin': 'df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119',
    '06800011.bin': 'dff66ff1ddcacaef9c64095b55b2602b7d90f7aa1495394f11dd9bcfd789893e',
    '06800012.bin': '08e3894c65fc2097725c98d6979f7e659172e3a569cc5f1cf341a94efcf1d50f',
    '06800111.bin': '58e30dc823fdea1a81f825850dc787074d5cb333a4a5ac56f34d74d19e74b482',
    '06800112.bin': 'c39aebf1d1450cf721f793c63d308ff9f38e28992f76f3a67fc3b08fff15f1ad',
    '06800211.bin': '060f279ef8fae8c954d3dab03490bbb77b00c69f28747202f8cc6aabce62aae1',
    '06800212.bin': 'ecdbf717d0e10319e03eae4047732a71749f34cf600fdaa5cbe34616ed4a89ad',
    '06800311.bin': '87a66ff93de6faa9f7e0dff875510ed19905043367f1ed96d2b8bcb128131460',
    '06800312.bin': '82ef40f5e7755f90d1db7ca625980da6d747fe495c3c4b3bfd081123067a495c',
    '06800411.bin': 'c6aabf8f6310502cdb9f04f3f92fcf8add5e5da3fb6353795971ba1e894e8a22',
    '06800412.bin': 'bc57d742e26ce16a7d7f7e750eeb758c7c49c6a7297fa14257cdb2015f72aa29',
    '06800511.bin': '86661c16a42ef92363612ae7660f795b3bb53b1362e7a05c8c3c7e1135ea7058',
    '06800512.bin': '59d554f8c73a43a179b572255aed22696e6774ede9c7cbf963b77ff4384850c1',
    '06800611.bin': 'd61acd1595348cad8f99312eb6896f89d216e61bc21dbbf81bda2254b523e9a7',
    '06800612.bin': '8f60a2425ed5d4b9d5cb41a324cba52b7e784e28cdb243b3d7a6abde848518ab',
    '06800711.bin': '9e640de5b05d466a9bf072b4f67dde204f2a1de749f921301b2bc0b0db37d00c',
    '06800712.bin': '69ca2c91199e4cf47be39da239472af65336941dfb8a3c8dc268b8e3dc66a532',
    '06800811.bin': '8d62e8eeb2a1635be802cfdcfbb80689f3699fb7ac147e80a2009336d221fdd8',
    '06800812.bin': 'db5dfffe43cece4903784216993d9955cb3e7deed7931c10842642a7af796973',
    '06800911.bin': '6577c7bd0b888be4301f45ec657da576bd4987788d7cfdb4b44756900554f012',
    '06800912.bin': '053ae5f9ddcc79e4705b44324e9399c5f2e15d944e2fedc85cf29d3e6a2f5f3d',
    '06800a11.bin': 'd877d85bff794817b280b9b5cd88f0e5b016a9fbcea5f1ea9f6070fb13a1a73e',
    '06800a12.bin': 'c3e5237ab032504f81af9803137260415b96f2f502099ccd0099857b3f827030',
    '06800b11.bin': '177fa2d83b940104a3a0f7582eb4227fc180549be6a8563dd829b6529405debe',
    '06800b12.bin': '64644116c1cee296db7a7f24c695a8b1369d798e588565eeef81649ed080ee34',
    '06800c11.bin': '31dae5b7135815658cb4885097672b114aa43014479375639ee4945cda6a90d4',
    '06800c12.bin': '5c5834d36558e1d3debad32519f872ec22f702fbca4af4c200e2c12fbb04a827',
    '0680ff00.bin': '3dbbff24e326965848e8bd1f2a0688cdde4755cb89cab1b5fc203d83c5d0d479',
    '0680ff01.bin': '5e732149e2e312ca68cdee0585f3e836027b7acd2814866fdade2c9efb722a0e',
    '0680ff02.bin': '646bc9044050f8b8362565803222149645508fd71708a19ee6cf8548c585462b',
    '0680ff03.bin': 'f4630c4152c73dfcdafe01327cbffcb755c4f15897819eeaa65b699980d60e0f',
    '0680ff05.bin': '75fe7bc26df6f1fa6f43f5ca761adb4d636aac664002396170f4cf1200d13db0',
    '0680ff07.bin': '76543abae5b0f285e75f008111e370c17c3cbb11a738679501b2796d23c472d6',
    '0680ff08.bin': '1dfdb82c94ffa526043be93f0c4dbb0e73ecc778265f2163881253dc95959011',
    '0680ff09.bin': '021be3080df868f1c50d2b2c50bbcbae489a03555f77f3d64f14048f887415bc',
    '0680ff0a.bin': 'df6c323adf1d0b51cb11070b37456c89df356f79a91fb53ed142ee240f2b095e',
    '0680ff0b.bin': '79fb82fa3f99d273b6a75e343362d717f3c64e10e51be6b337e46a1bc7e7bfd5',
    '0680ff0c.bin': '549f270e58ef176ec0247633ec880a36d7ab0e80cab0be15b8dde36388e6153c',
    '0680ff0e.bin': '51d71a83d4e690ee7f208dd335941d236bd2aaee3b7a77e41ffda6a9ae86513f',
    '0680ff0f.bin': '69fbfb900e50fc90d0de1adab7d4dd5b01c3ec4d47bd63de4c4bd865517a94cf',
    '0680ff10.bin': 'c29dbbfa5101cddb635b19c9d6296e4cb6664aa4eec3ab90138a68af1b2362ac',
    '0680ff11.bin': '6862e1bc7c49b83214e307e856f2c61bde44c0ee145ab1081f92d203cab859db',
    '0680ff12.bin': 'e24f35c80842810f33d9167284a4b5e69c4ba059865f089d1560f7119cafebea',
    '0680ff13.bin': '50729b0c051d6d96962272637a039d6f00d485f145eb011347522af5b1f78620',
    '0680ff14.bin': '9e3e2d627b0eea3775f6ea4c05e9ad02ad9f9b1969b0e6a0f16bd57bfccf701c',
    '0680ff15.bin': 'c7bd084294dcc783db235a163c76efe572058df0c6cd04ca67418dd8b5aa948b',
    '0680ff16.bin': 'f26eb458aba982150ac10a0cb0a90f28c5ff36ea08976692a3c266218146c23e',
    '0680ff17.bin': '1c0909328e79d1edbe7e97d3ba5c846c85474f8028a7edad329a5e3f9e872ff1',
    '0680ff18.bin': 'ad102dca136f6d5b46b377b8ccde18165410adb7302e7dfebec624564620278f',
    '0680ff19.bin': '0dd4dd037e0d3447adb90fb3611aac4237498682c4c01be3604a1330132bd8eb',
    '0680ff1a.bin': 'e89d657fbfe7166eddbde52ff8c158a0821a161f68e9f03df7df064aabd8f881',
    '0680ff1b.bin': 'aeadb843c424d22a5d62f7c99e958c8a4eb5d9e6e8d95232dd6c6f109c6a4714',
    '0680ff1c.bin': '30b35a9e8f0f4a391f4dca37d9dcb66004c625ab19f1af86377e364d166c0cd9',
    '0680ff1d.bin': '52b6e839af2fc8fbced65eecbdbcfa26834a39e309f53d4ef44b62e69f1b512c',
    '0680ff1e.bin': '96ec8ab6a0faf45aef9e8fcd1bfea9fcb34ad51220e9e24834fe7030d4653ba1',
    '0680ff1f.bin': 'a71dacc5875d8ec60ad5b9f70e7d19cfef58d7406750655ac6d333537aa9ccd5',
    '0680ff20.bin': '87408d92d91d891cb8e2643fa775c9b33a5039a7a301ec9575955a21f83b7ad1',
    '0680ff21.bin': '70f2665ea0e73113cfa7a889864698ecdab45133724ffb6372c85a53ede5f9a1',
    '0680ff22.bin': 'd116f44bbf223edc29d01bfe68656b72e7ffda56a9cf3a65313edb79a747ea1f',
    '0680ff23.bin': '6aa11898349abaabf939b88d1b6d2b60c26e9f7f38a875b475114383a7c6608f',
    '0680ff24.bin': 'ee05003e29d28854ad7ded803507f8e6cdd658f000d6de738c6720700438f5ae',
    '0680ff25.bin': 'e5ca81be8cd69d0932afa3c9d3aafa9575a474ee7fbb38441d1965b3d87daa68',
    '0680ff27.bin': '74e8ca81068b2d88aa1749e5f0466f745fc8cacdd879cf71af5a9c71c39dbf14',
    '0680ff28.bin': '6d0baac0a27c33b34f5340836ce0c9a93f69501d720ea58786a0682e33226626',
    '0680ff29.bin': 'f15a2ef79e1beb2156b744b322c5624e6e386a288eec9dd0ba2f7264eb7f50a2',
    '0680ff2a.bin': '1fc2ad7403876f165116aaef13002dc5533071786833bf745a3bc4aa4f8f29be',
    '0680ff2b.bin': '6e820d3c09dd409365637e6c5d81cba05ebae2eb1b1169fce7b96395afb36c9f',
    '0680ff2c.bin': '9ccd6a5aa38f84bd5603120353123b5a0563fe1c4d28537fd4dbcafee500f028',
    '0680ff2d.bin': '236fe6f61b3a57c402d8d6f32a260684a419ef461030ce6fbd71f631e0f5f9e3',
    '0680ff2e.bin': '2f0ef7c6bc70340a698a663e3bf131c72be041fd6a96eba481e3f0cd019d0622',
    '0680ff2f.bin': 'e1b65f596721a9ce5e77513fedc1a1040db5ad142a5435029aded73db063f777',
    '0680ff30.bin': 'e343961f3b6b6cce8d2f6e1d791d832a1da93097d61b37e9a66085f05d79d988',
    '0680ff31.bin': 'ef4f2e323bf116797e05e4532e1f073a9b31d1c4508b5b91b198e95bee00fecf',
    '0680ff32.bin': '30a183a2b00c19137ad6b6b22ddaa500496a730ca9f77d8e5c476ad2cb57840a',
    '0680ff33.bin': 'b2526832cab2a3450a663b4da86790421f1ff494581990b1e9ca28446d5b5c11',
    '0680ff34.bin': '2fd57e837e96b849a5e13313bf37b9c7033d7d69489683ef10c24dc49a7e315b',
    '0680ff35.bin': 'feb12fb05d6aa292e46f0d8a6408d7ac2169c2d51053f758e89df59a0bd9f1e8',
    '0680ff36.bin': '1de4a9c62b4922bbe5f72955408b030709bd901e81491c6e68be168143bb6693',
    '0680ff37.bin': 'd527e014c11c3c94e9ae2e60fa31c5edc07d461379d436e470d52fae54541909',
    '0680ff38.bin': 'f5bc67388ef62807fba49b2a85894c77974d2ef0db28065e81ade43863411221',
    '0680ff39.bin': '5f15a2c323bcb7ebcb42af395cc8c9b07950cffa6b752d7614978ebefb2d2318',
    '0680ff3a.bin': '3b7b1018f247101742f7b8a884ae7c1d41d406d72f344e252cb8a10251b8f0bb',
    '0680ff3b.bin': 'ad31993dc5c22d7726310032b69181b6b451a57f50c3e5f675e1248b5328b7b2',
    '0680ff3c.bin': '3208c7442a2682f313a462823da693bdc9766de13d63721d66fb347ca8acc40c',
    '0680ff3e.bin': '3fce57395c394f926bfcfb4ccc10b7db556bf8ae4e4b5edc01076791df904348',
    '0680ff3f.bin': '40c6c64ea05b53390b65c371bc2ef408b872ea6b59e702aa78869e9c66b3149b',
    '0680ff40.bin': '37c8e6231e13e6051417be654437533f9ade23098ac30d0948c6397c4f32098c',
    '0680ff41.bin': '27687667f0d7570e804c65013cf8898a65527b4e60203aac887999b77f2faaf4',
    '0680ff42.bin': '092e901ae1c24dadb321daf01c7407daf4bf7b80445620e6d0cc9a7b6ce7eed3',
    '0680ff43.bin': '21d2221417a836d3980e22676b722511aa642c6346e2f06ec11731302893643c',
    '0680ff44.bin': 'df8fb32231037ee5c5bb127d5678ce4c49c1fb53fd45c8763ea1949a412e3ab5',
    '0680ff45.bin': '13d2b520b75c41ba01aec8abb6626d91bab75b5a940728c946a09067e128b65e',
    '0680ff46.bin': '61fcfbc6198af13ec3d1b2ac30ccd7d42cc2501b84039ee71611dcb2fbfef32f',
    '0680ff47.bin': '35dca74f25270d13525fb94f42e65a7894427271d6d0baf61aabe38d40f660b6',
    '0680ff48.bin': 'fad2b877c13dbfb01a567c156437043682439949e9ad76640a13343f63e62575',
    '0680ff49.bin': 'c95c71711c3546306e083450b0a232e42562f0fe29774f52aa2ff2312c1fcd58',
    '0680ff4a.bin': '60308ad3b2a3b6f6ff74e10e755e44f48f4905d89593b1dc9b4dbeb08292397c',
    '0680ff4b.bin': 'f8af7a1c58daa642a075ed60def272864c24c6ec17383376da6c4cacabc62dce',
    '0680ff4c.bin': '4f0f556486dd4bde0e12a8bff2ed0ecc4a233fd72d1b89ec9740c5f6a4a98459',
    '0680ff4d.bin': 'f57d5f49e6b856087da2f702265f614071325bcdc27d204b93dd82ff2a51640f',
    '0680ff4e.bin': '2ea330c228af717d0048a8cee8becaab9bfa7e6abc9c048b026b8e575f4bdc70',
    '0680ff4f.bin': '0e35bfd205571c843bae32e9b911c42ba887fe2c02ea153b9e56c8de2c6b4b28',
    '0680ff50.bin': 'fc2cd3960a306c78f46e61aa39fe9aeb06f19c006fe104115d6ba1f0520633e1',
    '0680ff51.bin': 'b62f1a237b695003ed4e9e52266cb2f6be11cacd987feae4403a55efc70244ec',
    '0680ff52.bin': '290451c3df2401ac00bf23e432fb398ad7e427de8c7f7bb5946b76f03dc82f92',
    '0680ff53.bin': 'd05374b8a441717c680abaa5653cc93576c52327ddf03988940b0430cacd0f47',
    '0680ff54.bin': '056071d4749f4ff78f897ea172124b60e3e5c8917ea4980bfbea461bc5c1077e',
    '0680ff55.bin': '0a9747cb8bcff95cc680ab7de9ea4ff5f6085e1f73f376752129d3321deb3c2f',
    '0680ff56.bin': 'a71eb538d62ea9498af5f454ce4eab8efbe748f866c2f9e9318856b054bc6f4f',
    '0680ff57.bin': '6bf25adf5093c1b5e45f859d00ce0d5a529ca1b7da72d31c698d001f84654740',
    '0680ff58.bin': 'feba77f6485216aab050747d22b5ba34b14eec10dcb6d53cdd2be523e6af5d81',
    '0680ff59.bin': 'c0723f3a4f1166f641876749b02e3f506d2099019017d8027920adba67134f06',
    '0680ff5a.bin': '0d7cf9f27260452ff8e28bc4d48b763b96dd345ce3993564a4dc2b0e3f370ff9',
    '0680ff5b.bin': '969e2b25debd38e92d98a5eeedfbf626ddb25cd1fdc08b0fa3ba249b885aab80',
    '0680ff5c.bin': 'f977297d626f4373106f789bddcddf70dc8edf81afd50594c700701113f25edc',
    '0680ff5d.bin': '826b598ae4e99cd41e76da93f5ebc0a260e349cd2a2668b1efa176ecec2ace62',
    '0680ff5e.bin': 'aa161ffdb5bd6fd35b2405abf3394b65c0b8795837f949e42f418074d540321e',
    '0680ff5f.bin': '504fe81f6cdbd484b03a60b5acdff128cbf18cb8b04efc12de4d9ef35bbfaea0',
    '0680ff60.bin': '481b41a2fcdda167e9ed28f3a551887f5d8d44c8e934dc52318cab088c037902',
    '0680ff61.bin': '20ba4d799b820493eec1288020508888341604aade0af8baecee668ad6658667',
    '0680ff62.bin': '8aac857e32c9c7bacee3b4c88588621fb5e24b2d1ac4da80c59b29c63cc236b3',
    '0680ff63.bin': 'b4e5a7b745bb9fe2d573ea76037ccab30f372f17da0f9518997e8725c9813761',
    '0680ff64.bin': 'cd3db3a80d697fa0f39f866a3ba8318032af8a88df5cf6d9665f225225cacb9b',
    '0680ff65.bin': '3be7a5f64c40f962bbad01cc1dfa66c0bbdf54ea8c2f855a5acf04ff3bca3419',
    '0680ff66.bin': '8658da9797e2dff4de26977eab8a057d7c455fe59de133da537a7fe4fbf5825d',
    '0680ff67.bin': '46e24e4cc0d5acaf1015ef49117b62566eea7334d37a80f6861ea7f461f4bdc1',
    '0680ff68.bin': '9bdf1c6b8115019072547803be9032b8d6eb9337df2aaa015b7661e5c79ff8f2',
    '0680ff69.bin': 'f5f3696d549919ca7416868acb56c2e8069936906684df63f7069a5d396e0e87',
    '0680ff6a.bin': 'e16a496a52a908946bf37b0a906a8299155318f9deac8ea89ab53c538e0b514a',
    '0680ff6b.bin': 'e74bdb24fb82fcea06a80307716ce4360fe84798314cc92c55b3b75233dcec20',
    '0680ff6c.bin': '527446f94143350a29e827b3303ce036c6267b3163dc14c78560409524fa1639',
    '0680ff6d.bin': '5136cd0e96fb35ddd675efdc19b4f66ccf3f9ff0a21c6f6492fab436bf3ed79e',
    '0680ff6e.bin': '01e4b81987fac2b2bd2d231b8c12c2e85e0a90d6bd9d24003c034a8fa6fb604d',
    '0680ff6f.bin': 'aebd1683a1bfdbff68a909c4cdaaa43de05683ec74afd9725f4f338eee0f7510',
    '0680ff70.bin': 'fe3fe88a1a53373f028b536868f8dd89f019af9504f5f4da4e980eb4e97c4300',
    '0680ff71.bin': '21155980b720839d4292e176d9bd49b59194b93000c5e0f7a0b161d5b9e97629',
    '0680ff72.bin': 'a5732f27a666d88001534eb880fc253f07030704b9e7ad221bbb3408258506d3',
    '0680ff73.bin': 'd201d7d4f5de7e914c57fc11615aa22a1c7441a9f8124f9962d7dbb7f578fd9b',
    '0680ff74.bin': '3075e1ca1bad934b8eded5a027058c093f373233f65dd047d9b60830fbe6093b',
    '0680ff75.bin': 'd385190344be20d5360fa609a0ff8556b5a635ff313ab2a3fd13ae28186f7b68',
    '0680ff76.bin': '34a7c492b796c597c6fcd36ac01f1a650f66fc881a85ec31a03e56de4dab551c',
    '0680ff78.bin': '44c0cdd58c38fcaf095c243df832cd6dc840dd51e64553ce0f48ed19719e23bb',
    '0680ff79.bin': '7f54665055dfe8e10d9243d78c1e06aa9b6bb4c2d04f892ad6cfe9ac22734489',
    '0680ff7a.bin': 'adb0e93aea37f93ec41e22ff9bff1e98cbb6e0e2e674ac1ade67f2a502b708cd',
    '0680ff7b.bin': 'd55a724f0c3348d76178d0e52e5cea82da1e31b281e54f6076548d70f08ce5a1',
    '0680ff7c.bin': '192bdafba24568eb95dab0a2a1de1c66f422e0a1e9bca3c6e1c3a4f2b7fe17fe',
    '0680ff7d.bin': 'da0bb42586cc033c7b68e611905e11376711ec0e69190e131c7fce66266dad97',
    '0680ff7e.bin': '6d571b1f53d74950359cf4092ad257fa7d216809e9bdc20b19c24397a30f4b27',
    '0680ff7f.bin': '34f5f682adf5b4a995859cc7eb7c05573915167973da8ccd8751f71b9fa57d74',
    '0680ff80.bin': '4751e8ca6240417fd75c31e0de3e0009ef373e95d8eeb3b2e63ba4b2f1fc5e67',
    '0680ff81.bin': 'd92f89fea9c5a4679582bc39e35c5d55e48075ccd3772dee0d8a120e1c3fc199',
    '0680ff82.bin': '14778248dab4dd8ec98b0289b1931d542d80df4c13b90fc8caad62334896daf0',
    '0680ff83.bin': 'bc6a0d01887a70645bf9ca1a80788cccf711b5e98ebe9765a1646c638482d33d',
    '0680ff84.bin': '9b65cbc345617f98ee839d883931289c52b033f95c3ce11620d3a9f3e7638951',
    '0680ff85.bin': 'dd68b1fe89e59afee8fbebadc87728bae5a439c437136100c385ae5033ee3592',
    '0680ff86.bin': 'c71f5539c626fc2f09cd3ca9ba3b97e05af9fb0f00e35846958cae6639106ab1',
    '0680ff87.bin': '6a06e6496d2e3bc532b449d5bde50fa7815858129b2cb7852176e9efab07a6e6',
    '0680ff88.bin': '064c6f138e5ce060af63f2c0ea4d582f21d391a6bb9ac2f0b45393d8a42a6e36',
    '0680ff89.bin': 'dd16ee03f5bf84a2c3c6bbb5de7a1ee71020f5bd36ec7b1c82268397fd7d53ef',
    '07700000.bin': '0923a631733943ea75851f0720ce334933a4de56616bc8a1f7a23e7c6cd531dc',
    '07700001.bin': '40b4a895ff0e7eddea56b748e35bd267072d458b68407f12b26a792bacec9ea6',
    '07700002.bin': '01719bb578c8881ff45be565697361484625cc761347708e890a41082c7c0ecf',
    '0770000b.bin': '22859fa287637c24d11e5e2a6cc46919639ce41386e9b4665f0b27ba7d1458fc',
    '0770000c.bin': 'c5124ebc3ae299f3fd19332bc6fcd48f41d5d2f35f9eed259866ec2d11eeef97',
    '0770000d.bin': '721896d8e570fdf2b77d2ea46cdca5a9a3e30c431c031ff8e7d9e36f5bc97197',
    '0770000f.bin': 'c5f110273517774a0636a55b7f50112f98f721b6e5606d77804185fb73f44a0f',
    '07700011.bin': '8272529347f0eec99ab7884b88a0119975a9671e159fdda15b187443facfe206',
    '076506c1.bin': 'a4e4e9d70dbf65d279acb18fdcba34717e4006afdc4c42c46a9dc31e8c9b9f73',   # e027 model (export_web_enemy)
    '076506c2.bin': 'b69e6647ad51724335f325eec6b7ff97c019bde8dfa8868e7c4ec51f071c820a',   # e027 textures
    '076506cb.bin': '95430e94db04ee4cd74dd28b991ce8d30540423a827e162b24bdc1f470bac500',   # e027 rifle clips (r_gst)
    '076506cd.bin': '106921e6007653eeb13f6a9405999804f8eddf2fcaf36b95818af688def53757',   # e027 clips: the paratroopers' r_para* (script 159-164 cmd 0x19b; worker 0259)
    '07650e41.bin': '46566553c97b678893e7553b809cfe8a298853752e891944157beb8b81bac65e',   # e057 barrel model (export_web_enemy, props_view.js)
    '07650e42.bin': '9d3f285ec76e66595b0eb125e913f1e8aa8067d698a2a88783d0b3d0c0d2d313',   # e057 barrel texture
    '07670c01.bin': '6ed77efb07bb047e54f95bb0d53e43408c8d4774750f37213730641d6c226c74',   # g048 EM barrier base model (props_view.js)
    '07670c02.bin': '7ca4184dbc244063d6e863e80429a910fd70d92a76a6ed765c411dfdf97846af',   # g048 texture
    '07670c03.bin': '43c8179e4e8e4d64650f3efcf4f375f1fc5d2772a75720802610677b296cf2fb',   # g048 model FED (the beams; export_web_effects.py)
    '07670981.bin': '29488b3854b64387414f742e9e79a13e455e7f65378727b658918a62911975e6',   # g038 item model (export_web_enemy, items_view.js)
    '07670982.bin': 'a61a83b5d70a5a4b75b5ef098e1de2e1036bb22f9b7fd63da607f6ea0717b51a',   # g038 texture
    '076709c1.bin': '543fb3436e543a7cb8c131460fc39e231e2647b3ecff4a62c347537fa5df7e1b',   # g039 item model
    '076709c2.bin': '7b2d8cf9eb049bdae5d677f40d91ebc7c627a1e5099010878951683eb7a8e8eb',   # g039 texture
    '07670a01.bin': 'd6e6c47f73687becd730ec97641fb635f91f1365efc2dc9adc5b5f5a224d7de6',   # g040 item model
    '07670a02.bin': '315ee731f8bb997f21aecabe3ac7ec23d1713ddae2e2184e67be370b5d5cd34a',   # g040 texture
    '07670a41.bin': 'fd5d50d60642083e9e8be42b47d14feda5ba2988c4b7c6d8346f8a49c1f8e64e',   # g041 item model
    '07670a42.bin': '9a28ac19059a18147270f4fc6f20b999eaccb99f307c0c2bc6f072348929f096',   # g041 texture
    '07670e81.bin': '8798457c37eef092d4b9fd953c38e1494bd203c5496d587a0f973fdf77ec870f',   # g058 item model (the boss e024's drop; worker 0237)
    '07670e82.bin': '46dc13d00fb73125604be9cff0df05c8d3d2fb84791ecdc9eefa9556bc1a6b80',   # g058 texture
    '076710c1.bin': '5c87f180c54586a7b606988400997b9eef0b341690440267f71c616869cda0f8',   # g067 item model
    '076710c2.bin': 'a8c2402ce4aec90311207c1bb0c53cd48d98f6b986932e8901aceff5ff89bb5d',   # g067 texture
    '07671101.bin': '4c3c20b6a0560b26e733b03d71f6e6b2f42d96b2c31417066d0cc4d55131200a',   # g068 item model
    '07671102.bin': 'a46510be8df1db9e4ce2bd9d43697894235ba5adb39fd92a26857552220c0574',   # g068 texture
    '077700c1.bin': '3651ff2ee1a90b9ff2c40de1078d9a1d4d829c31c8edb178a100792c082fed4e',   # w003 rifle model (soldiers)
    '077700c2.bin': 'b3872f96ba1ca583b327c0edcd0279638928356d0acc734f4e2d88fecbac11a5',   # w003 textures
    '07770101.bin': 'abddbc0ed50cdcf956cf807ffde04258e9a21fb0916f1168376384e7e6a3aab9',   # w004 model
    '07770102.bin': '241f2c235d69e0b2f04b132279aff9d0d889527220348da94337b029c8387dfd',   # w004 textures
    '07650781.bin': '268bbdde2a9b6c921cbb6922e16a33e8ebf4be2a44c1f9c2019248b1be188188',   # e030 model (export_web_enemy)
    '07650782.bin': '86a99ed63bd3192997038e0abd995a294b965224ed39233456476ca15c546bb1',   # e030 textures
    '07650780.bin': '1f559386248f785472d796d0bd090da9bf734b96b6c25164b4503b1f41932960',   # e030 clips m000 (st_a)
    '07650c01.bin': 'cf726d599130408de23b88ac5c4f2514e84ebee3bf6e346f9293ec45008b50b4',   # e048 model
    '07650c02.bin': 'dfafefbec2e87e6cbb235a6cc9d36765fdd68cd5974e136214a1f366c1439a67',   # e048 textures
    '07650c0b.bin': 'e0d94acb79ab560ddc0aba450530d2f3fe76039c9f7e8e643278521a9ee45bcb',   # e048 rifle clips m001 (r_gst)
    '07650901.bin': '576353359ef6f903583e98316ed911109746db8b6de38510d6cfd40f0a7a652e',   # e036 model
    '07650902.bin': 'e643b72d44bd27773bb52515652689a3151b6cb5f8d8fa5b3f45360e47a3b3bb',   # e036 textures
    '07650900.bin': '06cc8ec975854e715bd1e88dd9b8d5f110e595249943a8d2b290ef4dd8b64950',   # e036 clips m000 (m_gst)
    '076505c1.bin': '93001dd18f2fa985cdf4e3b9450fc501ddc75a46ca0b8fb469622b49308e9dbd',   # e023 model
    '076505c2.bin': 'da9383366d3e7fa868dd29fc864578768df6d8fce151db46aad0df7e415d5e42',   # e023 textures
    '076505cb.bin': '7d4db9a7df0711a70591419d89999c39375de040debe43f7502f96a8d77523b0',   # e023 clips m001 (idle)
    '076505c3.bin': 'ef039f472fd5e9997b9d203ad715295a7b5d7f9bec2d0509b18a04194921bd43',   # e023 FED 0x405c0000 (rocket trail / blast; worker 0270)
    '07650603.bin': '46ed3259747042be8ca230c925c4aa6604ae6c2313e9d7b3f9dd52f77b609431',   # e024 FED 0x40600000 (missile trail / blast; worker 0270)
    '07650601.bin': '82a80ce24910de40f55b4a801421593f89fedbd76dc6f75ed78735dd18cc48a9',   # e024 model
    '07650602.bin': '3b36abb7fa20c0f4091ef12a72f51e802670500fa1900d6e3c662e65666d2bc0',   # e024 textures
    '07650600.bin': 'a140a2f1c369a3bb4fed25726533947e8242ddb32e21b9cbbfa2e1c3cf3da8ae',   # e024 clips m000 (idle)
    '07650041.bin': '5cf8aacbbf8180e64596cba5a8f21dd09a5ab841008bcecd6e489cdd55897484',   # e001 model
    '07650042.bin': 'c32c4a27b524a8ed7bff7cb2fe9e809a265dc350f25943963478d46893978a84',   # e001 textures
    '07650040.bin': 'c6fdc70867907cbf2b423e4bd8239f4ab98e69fdd1157eaf1a18aed373bde697',   # e001 clips m000 (n_st)
    '0765004b.bin': 'cbb669695daf5c1ca1ea1e1e32da65039bb648e845edd1fbe1a36864ce3c7970',   # e001 clips m001 (a_*: its stance 0x10 rows; worker 0230)
    '0765078b.bin': 'd90d38e85600afa918a4aeef3e63e20f9aead44ea814417806ec0d38bb276bef',   # e030 clips m001 (kidnap: trigger 163's cmd 0x19b; worker 0276)
    '076e070b.bin': 'bd639a5b5f54568394cba389f20ab549e2e18a9ddf72f42a7e1983b002b3494a',   # n028 clips m001 (kidnap: trigger 163's cmd 0x19b; worker 0276)
    '07703201.bin': '9b5570610fb12e2eaf834cec0025c3cc18f7c8a64ba5f92d416d0b78e5d315d9',
    '07703202.bin': '06cfcf6ce98c8e60abb4ba119489c67da2a70429bfd32df3c44acd271cb137c3',
    '07703200.bin': 'bac21ed575aa60e3742de4b0c1c36b787444de612f566b4d4e24f1a842181a75',
    '0770320b.bin': '2514dbc8b17af70e17fd2c837f05a6686353ab33b1d9f7dfbcf23abc9100ba0c',
    '0770320c.bin': '10f217b70bdf8aa813b4c6deed1dd7caacc5472d5ac1acf4b368023900ba6837',
    '0770320d.bin': '53290775212bcc4b41679936478fe94353a33d67aa196bb606fcc443d4e083cd',
    '0770320f.bin': '30ce86dd231938655d31f4318afa9d2829bd579bcec6c9d33b1bf031ceebb799',
    '07703211.bin': '8272529347f0eec99ab7884b88a0119975a9671e159fdda15b187443facfe206',
    '07770580.bin': '7be3083169b919c22f4cfe71cf775bcc44526b12fe9d2f46bc2ef291479c95c7',
    '07770581.bin': 'c9f56a9e30cc3e4676e2d856501ac140d198bed3d3262bb23e41a66c1a6f044a',
    '07770582.bin': '78ede02dcc7662df0e9e3fb1f9b0239b58a72cc46fc9b5fac49fd8bc341428f9',
    # z128 stance table ('bmd', FUN_0030fb78: stance flags C+0x808 + motion -> clip rows) for export_web_triggers.py
    '06800009.bin': '91dafa456ea158fd95726520cbe1ba0ded60b2980bd96ec91d57b07485021b76',
    # m000 motion sets (stance 0x1e, m_* clips) of e048 / e027 for export_web_triggers.py / export_web_enemy.py
    '07650c00.bin': '76c8fde91f0ab6ae694044bd22195ea3cadcccaf8b95e1535834562a7f6ccb44',
    '076506c0.bin': '509bc7023373208a3c7bff8495b52fb20561bd8432b0b3a8c259004dbcbd5d2e',
    # outside noPath (data/bgd): weapon parts for export_web_aim.py
    '../data/bgd/bgd.bin': 'cab126367d9fb61865d03323938cc422a450f15e4ab72de5999f6d2a6e21a9a3',
    # outside noPath (data/etc): the HUD 'menu2' texture (reticle) for export_web_aim.py
    '../data/etc/menudata.bin': 'b851a405451880e46a9f95c4be406b958ac81c44a9ac8de7bd7b8e7dccd74eb6',
    '../data/etc/KerberosIntermissionCalc.class': '03ddeb380b451fac6f9e4d8901a3bfcb858382a6a39d8060ce31a315557c86b1',   # export_web_results.py (worker 0232)
    '../data/effect/anything/a0050/a0093/fer/a0093.fed': '43ecbc7c2f06ba73e35e50b21ba44334d4b43a82fd041da1f14ecc9ae0c6d6f8',   # export_web_results.py: the Status screen's FED (worker 0241)
    # z128 sound: SE programs sep.bin (06zz0005) and names sdb.bin (06zz0008) for tools/audio/extract.py / bgm.py
    '06800005.bin': '519b914c16e6ab40592cb59c7a5f1270b772c65dc62778cd5cb08c0e3cc8ce28',
    '06800008.bin': 'e5854eb93c8e80479cda8935879d40dbdbab5fc5dbb5e81793c8227028bfeb3d',
    # the events' SE block (FileCode 0x0c064800: loadSoundEffectEx_l(0, 100, 0), FUN_003825e8; worker 0266)
    '0c064800.bin': '28153c633aa9d31e1382eb0c80986a76e9c2e49a009fcd9efd4bf56890aa70a0',
    # z128's area FEDs: the stage fire / smoke / embers (export_web_effects.py, worker 0208)
    '06800014.bin': '290b9e553387611a48cffa0aed1764563f3662a67bb5bd9371d3fda182860369',
    '06800114.bin': '0a54e64bbe31df21d5739aa27a6a41f28a40a7939c1221bf9ff81ae0c57651ec',
    '06800214.bin': '5328fabb1e1e41e85b7fffb9df3ca0dd952037b3530a00f80a79498062c12185',
    # outside noPath: sound driver + wave bank 0 (tools/audio/extract.py), the zone music (tools/audio/bgm.py)
    '../data/sound/lib/iopsound.irx': '86164af27e90c49ee8984ae3497d2225165a789a8271bdd019b16e74bfe74aa1',
    '../data/sound2/wave0000.wd': '2ded3a27599d1adb9d7ddaa564a0aacda1a58195634ab546ae36e7dffc9e308b',
    # the resident SE block (FileCode 0x02810001) and its names (0x03100034): menu sounds (tools/audio/extract.py)
    '../data/sound2/resident.bin': '3267617ab9456d458206ffffbfb44d3ed440e0a85e87f60019d01624ee98c43f',
    '../data/etc/ressddb.bin': 'a7f70c5cc23467ec3db99b28e34aefc02806bb2070cbac49a6f1d18fc1b9e1c2',
    '../data/zone/z128/sound/bgm_001.at3': '5c0e50d546d728590f4c974247401624d123df2d32abf2510da27ffd80555138',
    # worker 0215: the stage's other music (playMusic3 crossfade targets: battle 012 / 013, boss 014, kita_ev0145 018)
    '../data/zone/z128/sound/bgm_012.at3': 'dc3da1c5b53f8a84eb5ec06fa6305a1365b52db43ac6f282088c6d2151ba3e16',
    '../data/zone/z128/sound/bgm_013.at3': 'fe67537de52fe53dcda98a0ef8f6d8daded4a994e2e7110430a13dc45eac3ddb',
    '../data/zone/z128/sound/bgm_014.at3': 'fe0008071682681535119d01f5aaed86af551abc32bd729f6792100f4d81448f',
    '../data/zone/z128/sound/bgm_018.at3': 'c296a5ca8738724528846643a43218699065631346c8411c6121f88298b3aed6',
    # worker 0222: the opening event's music (ev0101 playMusic2("bgm_274"))
    '../data/zone/z128/sound/bgm_274.at3': 'dfb0336a5346903928902064f58acaf141a87b87f44dfcefb1ec322012ff061f',
    # worker 0222: the opening event's voices (ev0101 loadVoice2 / playVoice; tools/audio/voice.py)
    '../data/event/scene/ev0100/sound/10109vn.at2': '6d8162da5980962a3e7ba90fa1705c397424690e2b6ae6092b9cb740146c46e8',
    '../data/event/scene/ev0100/sound/10109v2.at2': '89fa0ae88bc91bffbbe21feefebd56fdc19283e20efdfadac8fa7d8404d02162',
    '../data/event/scene/ev0100/sound/10110sk.at2': '88009ba5db19b0c8c82519aba386b0382047eef078f7b5fe6169daa84dbe67bb',
    '../data/event/scene/ev0100/sound/10201vn.at2': '1677cd04bff30f5ce66d8de86793ccdb5e91ad7b3b50465505cb64ac0fd325ae',   # rv_matiawase (worker 0248)
    '../data/event/scene/ev0100/sound/10401sk.at2': 'be7551a4c562ed08dec058196aa84b31e82cd76d0ee6325b3244c80da323ca48',
    '../data/event/scene/ev0100/sound/10402sk.at2': '4ecba55d84b25faeaed5318b8f967922a794cd325716f177b68dd2655dce74d6',
    '../data/event/scene/ev0100/sound/10403az.at2': 'daa4bcd57d96f2784018cc9c1f2cab373ceefc66858a89419e09c6477dbef58f',
    '../data/event/scene/ev0100/sound/10404sk.at2': '9979c44036823c842627bd1a899de91b61a0ec1e0ee5ebb9adcda7d7cde9005f',
    '../data/event/scene/ev0100/sound/11001l1.at2': '7ca05f5110e81092f7a17448a295ab4d6b04313ae9515fa28a3de4ee2b0001cf',
    '../data/event/scene/ev0100/sound/11002vn.at2': '774585decb607b75da431218d192942aeac3d74a287b366b92fc91e45b00905a',
    '../data/event/scene/ev0100/sound/11003l1.at2': '9ac6f1f3c4224c26433ae659ba699e2971e6dff2caad3c746413bcf37a960217',
    '../data/event/scene/ev0100/sound/11004l1.at2': '66b08ae40cc1181801e6ef64e76e4a35f6c9b7ebee907d636adbffad13772bd2',
    '../data/event/scene/ev0100/sound/11005l2.at2': '08440667dab0076b662ae7d3a11b50058c14d88f77c2d0746fbcc7decd843bcf',
    '../data/event/scene/ev0100/sound/12023q1.at2': '5d40f96048bae004caf348710e730e66fc27cf170725b87289e95bdf674dd873',
    '../data/event/scene/ev0100/sound/12024q1.at2': '8bf60a203b1fae9ced85812dceb334e2e52c1575e56ad0ce4947f3c23ca0c486',
    '../data/event/scene/ev0100/sound/12029q6.at2': '139325b163452a2c368ffe1732e121bf444f08dbe386bf797e11c314a612439f',
    '../data/event/scene/ev0100/sound/12031q7.at2': '956ca6a453727c5c7fc80ee8f5192a02283ae94f026d311c378340bf78671bc8',
    '../data/event/scene/ev0100/sound/12032q7.at2': '4655f83404254ea01d491b544241e044c05e9d34470e14a3869aa67b50d5943a',
    '../data/event/scene/ev0100/sound/12033q4.at2': '23476a46a37f26afc77679b775b630714cdb9dd9aa1ba25fb5a16de45ea8957a',
    '../data/event/scene/ev0100/sound/12034q4.at2': '084fe4fda6703677072283352c195c1f31ef1704921b8084c00875fbaba08728',
    '../data/event/scene/ev0100/sound/12035q5.at2': '96e354e8be77f5b71c2b113fe4549e75c7262f5c4fe20ab5906aeaa96d884ec5',
    '../data/event/scene/ev0100/sound/12036q5.at2': 'baaff1203e6af74d74b74b89991f85d8db58015405f73095c4f0e3a9687b7ed3',
    '../data/event/scene/ev0100/sound/10901k1.at2': 'b48c319463d956d867e62296e94453e90515441c449468bbb6eb2ea41ddc360c',
    '../data/event/scene/ev0100/sound/10902k1.at2': '9848be28657c5c5a11ee15f5598a07ca51729db5abb5153d1c96cb31008eb970',
    '../data/event/scene/ev0100/sound/10903k1.at2': '118f261ef638ecc207fb752b8bee3f528f8316cd8ae45aac08680420f1f98d12',
    '../data/event/scene/ev0100/sound/10607fm.at2': '8d5ce5d91034c811d515fdbe6b34931475ece140cb293ae9ebcc0fb2521f7ee5',
    '../data/event/scene/ev0100/sound/10608fm.at2': '6aefcc5b20dd03dd56e7b2778544c916bf48477bb1606d8b1b63ed06b420d276',
    '../data/event/scene/ev0100/sound/10609fm.at2': '5f5fbb05f30b4bfb5d4e61dfa8348d4a7215e1e1fce544ba6c93d15842bcd028',
    '../data/event/scene/ev0100/sound/10616ri.at2': 'a1ddcedba7f4a0a58b7b51b3a65b3fd5d86f06ac6282cc21f0e7f49593a981ec',
    '../data/event/scene/ev0100/sound/10617mm.at2': '0e992ec1b84171eaffc38d560a6919d8d9aa3ea558608a6c4663d748ed7f60cd',
    '../data/event/scene/ev0100/sound/11102l3.at2': '34f4ce93bd5482f40bca5a3745f7ad9c59d782cf1c05331cf369e5b2414b6e4e',
    '../data/event/scene/ev0100/sound/11103vn.at2': 'f5b294eb663d3ccb10a8cf071a14b0f9b1ffd08da63fdd724f9550e99f857ada',
    '../data/event/scene/ev0100/sound/11104l3.at2': '31194ffb34b3ad0270617df37d8825843994bbda905bf76dad0e023f28b0a718',
    '../data/event/scene/ev0100/sound/11604m3.at2': 'a4c8be4d16df05af89b7ae362cd76e31b48b239bc2c26a051e4aeca057cc7dd6',
    '../data/event/scene/ev0100/sound/11608m4.at2': '85466837e8358b77993d3bbbcd2f646000b3b729c856ffe971b04a50fb3c20b1',
    '../data/event/scene/ev0100/sound/11611m5.at2': '387d858492d40241d324b0f082323973cc83150c569790271a199baa1327612b',
    '../data/event/scene/ev0100/sound/11907p1.at2': '95bb2cd520763d61968febb9a3a994c8d81b4040616824fbdecb23792f6aefe9',
    '../data/event/scene/ev0100/sound/11908p3.at2': 'ed3d8a4d3e371c3ed3aa785199723bde7bdce7f9454813877f42e922c7662a0e',
    '../data/event/scene/ev0100/sound/11909p2.at2': '40aa8ba01184b5be800f3cb8c64ab0c14292e9e39b89a341b78a5e33fbdc4d53',
    '../data/event/scene/ev0100/sound/12001q1.at2': '9220f11cf1ebf4de67ba17d06c3afb0561091e7e0b2b5ec177df51826994c59c',
    '../data/event/scene/ev0100/sound/12002q2.at2': 'd2d5d15e9817ad2c8a8df0561170c7debffe76b8124c1590f5af21d3b0bf685f',
    '../data/event/scene/ev0100/sound/12003q3.at2': '193dc67a5c7c912d40f159d430e83153fe724aaf76017a39ab6cf9ce0aa27460',
    '../data/event/scene/ev0100/sound/12004q1.at2': '731ae4761794db9862a14f9afd98cbbd40f7c028075bf7238b7bc50e72781a4b',
    '../data/event/scene/ev0100/sound/12005q2.at2': '9974760f672033d48161e3b388e8baab501928c02e57a846699e528a5f85aef3',
    '../data/event/scene/ev0100/sound/12006q3.at2': '75bbd3a7d65cb337a43688df1adc4b54f426ef9cfedeef8c40262400e1018dff',
    # outside noPath: resident effect file + effect texture pack (export_web_effects.py)
    '../data/effect/resident/r0000/r0001/fer/r0001.fed': '5faf7fdfd9f3a8c8f07de02cd4551711c544e531c8f9c602acf05e005fc0726b',
    '../data/effect/resident/r0000/r0000/fer/r0000.fed': 'b10188567af8d5f5d23be74b1e411672f1a259a9e5ee6672ee95ebff0fc60675',
    '../data/effect/core/core_ef.bin': 'dedce36b3decd8218c77ba28fa02e49dbc61a012f7269cef83653f131ed271a1',
    # outside noPath: the GAME OVER title FED (file 0x31000f5, export_web_gameover.py)
    '../data/effect/anything/a0050/a0097/fer/a0097.fed': '655c15f2919c0aa9be5921ccd7039896c1eb681c3cf394ea660794d7eb91f6d4',
    # the stage-info boxes (export_web_stageinfo.py, worker 0220): ev0100's message file, the box FED a0211 (file 0x3100085)
    '0c0641ca.bin': '99f2fdd0b88b1592fde3460f84f94e9968beec8824d539d28f62cf6febbd6119',
    '../data/effect/anything/a0200/a0211/fer/a0211.fed': '061e191289545e0b734251f8dea714832d26a60e2b413b70ad82915cc77f894b',
    # the opening's event effects (Effect.load(1): FED 0x80040000, the scanner SCOPE01_*, HINOKO, HEAD*; export_web_event_fx.py, worker 0275)
    '../data/effect/anything/a0000/a0001/fer/a0001.fed': '8cbe0c811c9780b90fc1ab07f49c88dbe96c59ad372261724411c10c402d3fc0',
    # outside noPath: the UK locale's menu textures, font and strings (export_web_hud.py, export_web_pause.py)
    '../data/etc/locale/uk/menudata.bin': '5a4d8679077abd937d5938417db218dd80e368dd0e5dc8e7734da26c8a3ba740',
    '../data/etc/locale/uk/fontdata1.bin': 'd9d46539391478cdbb9a8b7d517c2b3fe278c9a2da5c805f7c2105092675cdaf',
    '../data/etc/locale/uk/kelstr.bin': '26256ce641be079a56c7cee4a5ddd3b1c5702c39f18a946b090db3bbbf5b5305',
    # the opening event ev0100: its script class scr001 and the motion files searched for the battle clips
    # (export_web_checkpoint.py, worker 0205)
    '0c064001.bin': '5dd916bd71766dae09682eccdec6adfebafce057190ec9f42cc0e310d37a9393',
    '0c064205.bin': 'e8f0aece411862028c0d3b8e31b94ed1ee58f5132abeae12c5ed51fc65f642d2',
    # z128's stage controller: ev0100 scr000 (main) and scr002..scr007, and the camera files their events load
    # first_encounter, rv_toujou, wro_kaisetu: models, motion files, voices (worker 0263: notes/story-cutscenes.md)
    '0c06440e.bin': 'c76d6db431b06e9a735c348f6bbe9e5860c08b820c41d923c03cf64e1f43c39a',
    '0c06440f.bin': '9d9ae4d77f74289767cdf09405d3a2acba901dc62ee38afaf8ef1e1f58b700c5',
    '0c064410.bin': '7875565c850d5b62ab4d8d4b575eee7b23208c54f7d5d189c173d72685dd05f6',
    '0c064411.bin': '23ee47677cdd985c4cf0f853a5ce3e9202c8bc502b3c3555527bada6f688f7ce',
    '0c064412.bin': '902e823b0339e6b2d512b87f2f59e0e62ba8299d3d9d26868f272f44756ac410',
    '0c064413.bin': '0970b42c025ccfbc75b2352720e5ee257baf78154fe07a14e21cc00ffe3558b0',
    '0c064414.bin': 'b19017c34bdcc29ca4d0b735a0813ed15469340d2fd2e20c3fbd4357b8425039',
    '0c064415.bin': '5fca253af0f7ba6f6bbacac1918eeddcb9bdf9e3622a12bd1bf91d190862fd64',
    '0c064416.bin': 'db2825da97573821ef454ff2b2c1d96f24b2c34075dda1061c6f5b4bb3627016',
    '0c064417.bin': 'dbb49ec014138d2954cc2473cb6eab560b2d9a77c60ed7814f5cad37839ec7de',
    '0c064418.bin': 'caa596ba8b970c39b42c24933979617813d937398e15828a9b1186493e2db0b0',
    '0c064419.bin': 'f4b667e646338f40846cf80350577566bec1ff6a40690b383ec0798ffec25958',
    '0c06441a.bin': '1758d78ab7a1204b1f8dc1c177a1c7c067f642f8ba4f67076c2dd7b2801821a9',
    '0c06441b.bin': '2685882121b03aeb1cced4bd57e95bc01172bb4141375fb7df1d8946caaa4b29',
    '0c06441c.bin': 'ffee8caec9a88d1fd8840f89a67487b7e4ddb9353be011d3309d1538b45a2144',
    '0c06441e.bin': '64ea4a8bb706fde714e6e9e177dc7adff3c6c44fc8e916ef8efa5f9da48a37ae',
    '0c064420.bin': 'c6d323d0cbf8a067d50d1d3b200a29ccf73f6005d2c3cd012296c4cb8dc9a250',
    '0c064421.bin': '52c70cdd98325d48b044982c205e90790f0e037808f00bf124264573f739ac46',
    '0c064423.bin': 'b84391ef568098a97b986cfbc84929e1bd9e191cd6d360a3e8c3c606a47985e4',
    '0c064424.bin': 'a48d8dcd36e97f075ebc8da376fa22b2410450884805ad1d88df73033238f2dd',
    '0c064425.bin': 'ce05e8be86d5d72c48f378a6e093f37830ec369eac0ffa1b3858032f5f486650',
    '0c064426.bin': 'bac870023bb58361866e8d20e39cefadc08646e5119f8b8380e1ca589c54af92',
    '0c064427.bin': '64070841e00bd90189e7db79f53e06d9b5f716988e7b3c2d93455cfaef9f2df1',
    '0c064478.bin': '12f29019a6f922ce941b15c22de83d335113a7a810b7ec14e032c5092b4da3e0',
    '0c064479.bin': '93e72929e054db2230fff7877a2855e423c43112a8f3c4622a71a75ee97aec04',
    '0c06447a.bin': 'd6417241b67992753c723f06197b3ec2da15ad80526e175093e0f5c0154ed310',
    '0c06447c.bin': 'a8bbb9f3297b94b262905f3f7141ca25bd17dc48b8a990fc84893297e2734ef4',
    '0c06447f.bin': '61bf0015484bd1e9a1ef4fdccc883eabb6e1a8ddd9f54636295b1807f061d73a',
    '0c064481.bin': '655c0ca1c3ed474a489c4f0e40dfcbda41436d233e68d515a979609a3d9c0e1c',
    '0c064482.bin': '08115ddef31e67f2746df68c5a1ca36509fb2e701a43badffeac7bbe567a84cc',
    '0c064483.bin': 'b41bd7130b124d899864865e08836100f6811fb5b7ec8caa6d7679bd826b8da4',
    '0c064484.bin': 'e0f2f43d3122af50db9dd35f55016e12ed771cb6e9838bafb76ac853d045bb4f',
    '0c064487.bin': '5e7d0ad5787fe8e5166ea2d0599b007230e2f71726b4f0b5d7e1fbce09ed8b5e',
    '076e0101.bin': '137022184b0d02bb24e455c4abc1a0df2e462e13efe0d074a64868af58f9088c',
    '076e0102.bin': '5edcd148f070468ec1e045248d11f5b80627a5fec4b4f7a3c46e514223397701',
    '076e0141.bin': 'b2514c2f174ca135921e6573e50315396ab0b3b8307de2080f0b609d81b69968',
    '076e0142.bin': '60701d1ce0b6db4fa9b6344b921642830f6681e909d02dea8cb511239fe777f7',
    '076e0301.bin': 'dea192d72539dc0dbed422d0a6a90abc188977b8023adb7269a75ece617b996f',
    '076e0302.bin': '7dac42103b2d4259f23ae4bd73add11cb52aa6db4e578b0c04adf97e06a9ad7b',
    '076e06c1.bin': '4596ef0ddde6b773ae4850488581d90a4afd26660051a68e0adbfc29a4b5924d',
    '076e06c2.bin': 'deb6c65877ea5230413201c4f07a335455c329fcddab4e1894037bcc4f6a35b8',
    '07770241.bin': 'ea0e2e7374866f5878df0e2f504bb1ba506cf321d5c350e0bf7fe59acc814720',
    '07770242.bin': 'd277b2b2382e3b49a10962be20cd70cb22dd0c04e5d4f46a4acfce04142d0f17',
    '07770381.bin': '8a2e7ce34df1a008783efec4a6f85d9bbee2146a3c6ec30e60e3c7024718e9cc',
    '07770382.bin': '697fbfe12f2b0152a1cfdf41a7abaafd25198cffcd521ca443fa0c43307ebece',
    '../data/event/scene/ev0100/sound/10406sk.at2': '2e65016329f57ebb56f65f7989f09322f0dbd2bd619321b902dbc921fe367f41',
    '../data/event/scene/ev0100/sound/10408sk.at2': '53480d834732d83a138a2e364c3c3a4dc2105c8f2591c1c4d0099dc49615122f',
    '../data/event/scene/ev0100/sound/10409az.at2': '3da18aaf73b325197ae82ace0638545cfd50e08ff409828952758a0984edc31d',
    '../data/event/scene/ev0100/sound/10410wl.at2': 'f6f3326979b0b79faec6650afed0a414ed95c8443ab8896a56bebb3f74535c49',
    '../data/event/scene/ev0100/sound/10501az.at2': '681158839a802ad1c61d92c346e6b3c770c947e5895db3ce9b93ed2cd37a81ba',
    '../data/event/scene/ev0100/sound/10502sk.at2': '2feb374453c27a910f4ee5d2835a0313a166ccfe9609a37a778be704c8d5dc7b',
    '../data/event/scene/ev0100/sound/10503az.at2': 'b780d14eb3d25505eb4f4e6388b6f0d11773c2a6af0bb7bff78c5e32df009fae',
    '../data/event/scene/ev0100/sound/10504sk.at2': 'f8e1d06cb38d9e4290394d8b19e2193e4aba2dd56b6f80646a46911067241024',
    '../data/event/scene/ev0100/sound/10505az.at2': '3817632837ae611f8253fa98a95a6bf0f84117fefa3a23179a0c4a8c2f3a05c9',
    '../data/event/scene/ev0100/sound/10506rv.at2': 'fb6b0ad3778aa63b0188a1988d5a158d0e9f0db3f324717ce76067638a8f86ca',
    '../data/event/scene/ev0100/sound/10507rv.at2': '77f5f347ba0cef75b82bc7d79c83e7ed051338efd28e39424dfcf17bef8c13c9',
    '../data/event/scene/ev0100/sound/10508vn.at2': 'b4a6091f68ca9aaaba8b084507b90adc2e8d780bb9df8636aaa672313e432732',
    '../data/event/scene/ev0100/sound/10509vn.at2': '32359dc1a2fda89406e56bde0ab817bf4e46a9dfbba4afb9e1a7d53423200031',
    '../data/event/scene/ev0100/sound/10510rv.at2': 'e196551c4ce032525936a6d378db03e45869c1061eda650c4610f6d125546684',
    '../data/event/scene/ev0100/sound/10511rv.at2': '86449b88e23b50d0aaed7667ef8b48b0999fc0d314b8727151ab2db01cbadf33',
    '../data/event/scene/ev0100/sound/10512vn.at2': 'c4f453250708b674c96adf95488c82b806cdf35b48e8de7b456a53c3ae883a41',
    '../data/event/scene/ev0100/sound/10513rv.at2': 'c8f8e449d9bc828d03c8ce560f113b94e4b7842b7c2505e62a252c781b226e51',
    '../data/event/scene/ev0100/sound/10514rv.at2': '3a05e5a0f5a6f2f84904c6486d683e1388aa25bfc8ce20e3d7e7f12a0fa3464f',
    '../data/event/scene/ev0100/sound/10515wh.at2': 'c3f71a74dd1c017b30e999498bc5f50e31998726e0c2388d68e2094057f85e80',
    '../data/event/scene/ev0100/sound/10516rv.at2': '1fcafb1380b6762a408fdbd067a5101a44b5bd119419a0e69b284e09fdcbe14c',
    '../data/event/scene/ev0100/sound/10517rv.at2': 'db9773b87f05ba9aab35b9a5edc1ff6b095b85c1fcf82c6d7ce0a60becc7c97e',
    '../data/event/scene/ev0100/sound/10518vn.at2': '7113fffe5d507fd0e31e571195c87163f218ed5ca16c3e613de145b225543aa7',
    '../data/event/scene/ev0100/sound/10519rv.at2': '61938ad70d81b021e16fdc04f6dde9f8eca224fb5598091699a2e8ac8d707f31',
    '../data/event/scene/ev0100/sound/10520vn.at2': 'ea39f1af996f727664952a6acf05f37fcddf0a0a27cc80428a41089cfb3536df',
    '../data/event/scene/ev0100/sound/10521rv.at2': 'c9789ac2fd2061233c5c2ee87055f59c6484d56ffa81630f949526424d172841',
    '../data/event/scene/ev0100/sound/10522vn.at2': 'b7e019a786d3421bfaf68696bb493acc5d30d677867451f8055315c39a8252ff',
    '../data/event/scene/ev0100/sound/10523ct.at2': '96596857094bab30cd4f513f1c7483ba68a14f7b263e29470cf69b428080d254',
    '../data/event/scene/ev0100/sound/10524ct.at2': 'f626b38c470751359cdddbd3091ad57944e5d1e3069a8d441eecc04c79290ef7',
    '../data/event/scene/ev0100/sound/10525vn.at2': 'b1f366703fa250563cdffcfabb1026d54684ddd8c0c2a587b29301b50798287c',
    '../data/event/scene/ev0100/sound/10526ct.at2': '53d539166c883a66ed6a35012bd805b3e7402245bec6293e78cf9fc88fcb0b26',
    '../data/event/scene/ev0100/sound/10527ct.at2': '3457ed2c94ae5478157911ce944deba5f73c1d8ff2f1f22889f27610cd5dfe48',
    '../data/event/scene/ev0100/sound/10528ct.at2': 'bbe1f68251f0ec2fb30d8071ddab70afb551ceaf0d3fd5516e5bef57dd22d1c4',
    '../data/event/scene/ev0100/sound/10529rv.at2': 'd714d530c6fc8833eecdc26b2666d2d273ca540502bae03c7b3954802b9ab487',
    '../data/event/scene/ev0100/sound/10530rv.at2': 'c0c3c708d11427192fc84eb05fc81d709334e746054751e5fa7be3d046ca98da',
    '../data/event/scene/ev0100/sound/10601wr.at2': '3bbaa481e38f3a418aab2165e2d54a8d72d570d1f168ddda149c69175da2c29c',
    '../data/event/scene/ev0100/sound/10602wr.at2': '7d4803352ef559eb26036854d069e397c63f3f2a5dbb538244746fee6ee1683d',
    '../data/event/scene/ev0100/sound/10603wr.at2': 'a8329c87dcf4a0be44e61725071e057b16066e14022e879030e9428314adbae5',
    '../data/event/scene/ev0100/sound/10604wr.at2': 'cf015361e2c14efa3a24671b7fb8931e994d54113ae40a296ecd2a185999a734',
    '../data/event/scene/ev0100/sound/10605wr.at2': '3a830d46422dee6d1b3eab77ce16fa6f0902992bb3f531fdb76dddce2591af2c',
    '../data/event/scene/ev0100/sound/10606wr.at2': '6991681519dfcfcb12a276c75f9c91f189f8ebe656be733e8e73e26c073ecb2f',
    '../data/event/scene/ev0100/sound/11801o1.at2': '622f865d7f3c8813b81ac4f0b6d72e86a1db66f86730641c9a94117cd1505108',
    '../data/event/scene/ev0100/sound/11802o2.at2': 'a57193d5d81e8be1dccddfaec7f0294d05905adb669e887443db1c28cca3677f',
    '../data/event/scene/ev0100/sound/11803o3.at2': '2eab236d68a4df97f836f2fa8240b80ec070493c020b55252fcfe9210142e639',
    '../data/event/scene/ev0100/sound/11804o4.at2': 'c21a8225a8c22592a3de2913a6a6d81d9b56a1863a207ae6483bbcee76c2c51a',
    # story events' actors (export_web_event_actors.py, worker 0261: notes/story-cutscenes.md)
    '0c06447d.bin': '4642f2a2d2ac2d57a23f00314070807249700a267f30c3a0943af33f56681aa1',
    '0c06447e.bin': '6a7ffed446867f2d15188c35baf2521cae8279864614f5c8e5efb049ef9831c8',
    '0c064485.bin': '1340e9eeb62ced3330c66c60ad74d131546258dbbab2b4e9e469c6b68a6a0552',
    '0c0644bc.bin': '97cf81a69a5699c7253d37b3411f89cde381a63ca3b813f90338ab76af3b619f',
    '0c0644bd.bin': '3f67898ac166ef27ae9f031b064a24b642643af632923f7d23106710f3dd37de',
    '0c0644bf.bin': 'f0d9860bd6f3baf7fce0b61cbb1c4263a9b5d427e0af0da30a7439a3ed24c67a',
    '0c0644c0.bin': 'c4f779aeb8fa3b2e27990bd173d3d96ea92c92a867fce355dd0f66eb9177bc14',
    '0c0644c1.bin': '77ced22475df9d2fe57307f30e7ca615d9a50fdf91b5cbf6fd28e2e1ff1ca81f',
    '0c0644c2.bin': 'b796bf133ed6663063e318ac5c8e315c46769adb57f406ac9bab80b4dc6cbf3e',
    '0c0644c3.bin': 'e03d60825948f2c83a87ccf1ed2392d2d4a4e8179d2213acb30a10130eadfe3d',
    '0c0644c4.bin': '71e36b1c749cf7302992d7890f707e1265a9d90c63b2dbca589e5727b0502cdb',
    '07650c81.bin': 'a84a35fa8e4b8ef0b78ae838f16aa0fd67a377a385a529b5bc8e9e734f2e11b7',
    '07650c82.bin': '6004113da7cc060557e357cebc2743162d00c53662e6a8b229ac61602b925096',
    '077702c1.bin': 'f10ddf0913c218198205e135d33a51c754cd04fc4b2fce24fd6eb812d13f0f37',
    '077702c2.bin': '411ad90c4e172e0ff28448c10b754651ec6fa39da8a52e3bb0b5904b5032549d',
    '0c064493.bin': '936d09095f52a1100792bc8517236153cc607b64e195eef0d624899c5de80da0',
    '0c0644dc.bin': 'd3ef764944099b618977c27fe58da8b305301f66539f2ee6f7476dacf5d83fb8',
    '0c0644dd.bin': '17d92e202177401a17a207f20035a7d8e0cac928804ab1e33319a7f3a820942d',
    # heri_toujou, heri_dgsol, heri_lastst, heri_lasted, kita_ev0145: motion files and models (export_web_event_actors.py, worker 0262)
    '0c0644a0.bin': '3831fbda23ea8a9788b1290117b5de3fac06733936094b6cc0d57078b0fe4223',
    '0c0644a1.bin': '6f755ba2c975cb0cb219549151477636adef9170ce1388e97db1d5080068ca9b',
    '0c0644a2.bin': '73079e151672cd3ce222adccda3dac5dc34fe36147ce2a3af7617c02e70cd8b1',
    '0c0644a3.bin': 'a362696963701ddcfc12190fae68fdf6e133f967fb864fde8ea736adb55c24f0',
    '0c0644a4.bin': 'eb57b31df57b000055b1a6de92c49f0afca348be61f70592224cf0a617112e78',
    '0c0644a5.bin': '55855c855a850fc7a9a02a51575351d6d9205fa51c4519a7c91d0cb200c647c2',
    '0c0644a6.bin': '1d7885031387a4a9b7415d33d93c77f785ad80beba152b4ce19848955bd533fc',
    '0c0644a7.bin': 'efe2ad02a9aad63947eac7b51c1948e655e3ac328d2d6b8f813bb93fce15f0b6',
    '0c0644a8.bin': '037513bcf3c569482fd3e580409439dac73ed3ccaaf221cd33451c95649a5a4f',
    '0c0644a9.bin': 'ea48507212d8b21c5a3f84c01b79ff774eeaea9777d4b0871ec4b9f8475b145a',
    '0c0644aa.bin': '67169aea45881a01fe1caaa938c4b582adeffcb3fb31c1cb21b1983788de532d',
    '0c0644ab.bin': '4c899139be95e679e71fd1fb5dc1b71fc15930ee88f11b1de867cb7aa57fe140',
    '0c0644ac.bin': 'b69f3ea8813e86d679df871b764577c02ff44c0be3afa92849f6ce315989cb42',
    '0c0644ad.bin': 'f6a60f9dc7fbf44ebbdc231508bb31757abe516a573ac712fc9d89271c9032c0',
    '0c0644ae.bin': '0704990c1e6629a416c57c8514841e2fc0119fd227483d61b3482afe11a83aa8',
    '0c0644af.bin': '91b0abc16ca22cff2856239d1d7dce6e1dc0f8956af08c6e6ee91a5c98b8ef96',
    '0c0644b0.bin': '968299aac3ec9a1e1feeef3ce0e6ecd56c262e55731fc498508f1a401bb2618f',
    '0c0644b1.bin': '78639a17f8f0a1583db3044e8d7ffa582c8429e6cea3dd11a7a7eddb59cac6d2',
    '0c0644b2.bin': 'a7adc366979f45cd9c93ceaa285d247d1e605fbc90640e1aca8c521a60c69ddd',
    '0c0644b3.bin': '9fad47aa0c8e13837a68c5fec6c8909fbd2524ec4a25c1f207e51abcfdae623c',
    '0c0644b4.bin': '20cb33508eddcaa0401bff90370b4da092dbfd36cfd89b48dd0f31f156c89150',
    '0c0644b5.bin': '5c2000dce7d4b938be1e495bc419aa8cc7a44bb11dd5eb7447ada379145bb79b',
    '0c0644b6.bin': 'a8223c7478ebd40fd5dd22a2fe9644c74678cde8465e56dbfdd4dd685fed86bb',
    '0c0644b7.bin': 'd6b0c3722a1fa21656494af4402c9c898738352f83e3d1f55b2b4a6535ba1479',
    '0c0644b8.bin': '55267285462b1d70573009053396234d8b2b73631fb15c820b64f384fe7d8a67',
    '0c0644b9.bin': '88adb359ae7e73356b622767967f0678f946aa63042dd2bc79a5304cd25a6928',
    '0c0644ba.bin': '57a876412df3c72cfa61d0517dec2bdb5e1a1d143f78e2094f40740b54621b7a',
    '0c0644bb.bin': 'e034797d96f9eee2a2151ffb65734554779e7743799653f1402d9a154f512fa5',
    '0c064450.bin': 'd9a00d8a007b3f0a4b857c8bfb00ffe9db7aeb7d59837750cd493d7b909479c2',
    '0c064451.bin': '2bc8468e1e9b5ca754d7eac15f0244f1e89988c00f8d3b120ed3c26799d15547',
    '0c064452.bin': '89a8ac69f69702aad748671d7c9859bb36b812dca3f8e733f06ac3c2ad2e3937',
    '0c064453.bin': 'e26be5862e682f1f0ff0e859bd45f17e4ccb8ec25015f50dc5a612c15f8573b1',
    '0c064454.bin': '3db9ec37e6f1cc63f6a858b45e9ee2be45617b50624d02cf76bc5c0422f48ddf',
    '0c064455.bin': 'f2663a1444a14a50568f3c7463934c8066c4b743b8e9f68540dd920ee8d835e4',
    '0c064456.bin': 'e1f9b72f84689a2e58a5b2c911967f9efc6540d519aa081a4886f8fb978b4700',
    '0c064457.bin': '000c9e994031286948fc5e09070d5449b3606e6301164233db530343cd958552',
    '0c064458.bin': 'f55bd71d7c0c2d25d91b1e3306f4a08c81df3ec17458c61bf12384ee3396ac50',
    '0c064459.bin': 'b0bf51159928ecddf840265a476f50c3737ac716fe19fd168295716157a3cd61',
    '0c06445a.bin': '83de4f62683d63df8f334a94f9f733ee45a0a42664fff5c2a162ababd791ace0',
    '0c06445b.bin': 'bdaf9aa07e3d5ff4f4c4726406c487500c3dcd007d2adfab40cdf55452a2559d',
    '0c06445c.bin': '0da2afccbda427a4930772c8b0ac11f8e121bdfdf463b95c7397bf4678019d34',
    '0c06445d.bin': 'e0f70ea5b0c2887aa706c1bd11c1701616c7aabf388eccf2943a3656e55dff37',
    '0c06445e.bin': 'b27e39fa63b3fd52b1cbc60415edd180d2b7e7c7d78ad3d520a2263a88f56021',
    '0c06445f.bin': '3ec7a27c839a8143f9abae9e8632475c78043359ed7226b44dea7909f6f2a035',
    '0c064460.bin': 'cb4208ffb122c2def97e179bb31d3072e16bc0f6a50cd051b1d2e25aff5aae35',
    '0c064461.bin': '43c05407c064acd0ddce314378eff422cbdd2545aea87fdb4f80eec14a819cde',
    '0c064462.bin': 'd324a2dd160facf0ccd9bf973e57c050ccb4357d2aa4bfe7d05159e2b12e9a1b',
    '0c064463.bin': '914a55de9cb954c4f7b5bb9f8ec09105ca7f7220d6ef3a0f99b03c18e2a0021f',
    '0c064464.bin': 'a8a5f60fc48ea3aaf8a11fe92dbd7d113890e6455d7399610b6fa5535fbf981a',
    '0c064465.bin': '5606787cffc4dbe1d95db7fb5510cc35985017f4453e01a81d8e2ec16102052f',
    '0c064466.bin': '7b630789114372420e5eb98b3f257cacf13d0f200221f85637663073b8aa9b40',
    '07670301.bin': 'eaf9d9e52939478e3c23ad16ec74e92591dfff9b241b5967ede2d883fc8f8204',   # g012
    '07670302.bin': 'fd69107740eb68643eb4c6c793369e96f413d7e9084af4bb7ca9dd1e71328309',   # g012
    '07670841.bin': '020ec4867b9460ffc8c0e7c8c94be570885d80634fa48fb1076387f0849260d0',   # g033
    '07670842.bin': '3f8f0c880066a96a21d547072e253fe93a620e08595f046aacce62c98adcbfd7',   # g033
    '076711c1.bin': '97285fbc8c41b8ff2affd42642082738908eb78e8b653940c090993ec4b50752',   # g071
    '076711c2.bin': '54de1bbf8e4388e6cc2d88cdef2ea62ee6893baf2ee6edbc4b5501581bfe7198',   # g071
    '076e0001.bin': '3705a8244654afb369e4609a850ef84321ee4d32ed3a5f10d26cb2a583bdcb70',   # n000
    '076e0002.bin': 'c4f806c1b2a360a08bc1ac708d76b4d35560a8ed4294b911d8cc3ba62dfa3fd7',   # n000
    '076e0901.bin': '85deaac8dcc17765168127a2a4b4c114db0089766fec9c2e244161c669a2ba89',   # n036
    '076e0902.bin': '7e773a38f9fb5506fa427b481f10415398e264011793806cf6908f7b2d9b9ac4',   # n036
    '076e0ac1.bin': '35724f042bcd278ea3cd025d402c2b75a4a92c92784775101b0e5cd25001dba4',   # n043
    '076e0ac2.bin': '5e5ebd82bf9723d828c0dd08fbf32c2597aefe1902377df214b4f4b378179f3d',   # n043
    '076e0b41.bin': '5b3f8ea69ec39369f8c2d3281561de52dac2657c3476817b39b8dc279890b804',   # n045
    '076e0b42.bin': '95461706c6ddc0554e2b25da9d5022017e1bb1c7715adb448803c328371192df',   # n045
    '07700041.bin': '2bcadbb4a630017f34183c5663610f5e8c25adf63f5685fd33e5ad3e2d281c14',   # p001
    '07700042.bin': 'cd755e0c1d98fa5ea32be458766959feec92794a0d6953f285068ec69f0a5773',   # p001
    '077003c1.bin': 'b668ec61893d73c01a4c6e002554eb1a265b299d6cf87480bc20cdec3516dce8',   # p015
    '077003c2.bin': '732a8dadb9e836cbdc3970f5f37db2abc75ff4a79af5a6f5cc08cba55e0b2514',   # p015
    '077701c1.bin': '4a83db43cbdc5de231cbbbed5d609e20570255ccaf72ad80d0cbc5e9adcae87a',   # w007
    '077701c2.bin': 'e3c50799a0c60365e48791ba02d6549b278d6b808ea1a4b1eb47971f5bffa430',   # w007
    '../data/event/scene/ev0100/sound/10301vn.at2': '903af2d61fbc02fc07ad211cfa492d5d74d684be193776f4afcd68892ea891a5',
    '../data/event/scene/ev0100/sound/10302vn.at2': 'd21a0b3be69b84d7954d81613b60d9bc0f081e8b78926803385d45361700382c',
    '../data/event/scene/ev0100/sound/10701rv.at2': '8a2f203d667e5a907f96648a531b7944820767dedd4996af04dd6df1b69c9f57',
    '../data/event/scene/ev0100/sound/10702rv.at2': 'f668a447ce2622f3becd44ee9d7eaf696eb0e7d5b9a522e78152e54f25a7a21d',
    '../data/event/scene/ev0100/sound/10703vn.at2': '5bfacd03fc3b79b63fa0cadd2bd6128956a27f6b81a282e72d6e87026f557afb',
    '../data/event/scene/ev0100/sound/10704rv.at2': '7d0bebf9b8b6e694c7d183402c8848fd3e4a673ff119d4c933f6e9d91180d2f7',
    '../data/event/scene/ev0100/sound/10705rv.at2': '547d0531a01d3b45db0a0faca283a53de65fc11bbc190c1a603730546624a2e5',
    # scr005's actors (worker 0261)
    '0765004c.bin': '8c8e33077ce8419f31064f4226d766ace8d82d2d001edd21b8df6e108a270cb6',   # e001 m002: st
    '076e0440.bin': 'd2ec95352dd9fba039d1620a626fe4c317b20d459cf84afe3794fe68203c59f1',   # n017 m000: m_gst
    '0c06449a.bin': '80dfb05bb8e399584278dcb1415511d9e05473acfa16d6120386f2a2ab1a0b39',
    '0c0644e1.bin': '33e2d47fedaad9cee8a54649e0bb334395c124b8d6084c23acc09d60c7540d4d',
    '0c06448d.bin': '3fbf579d914b79e1879c4527b68750344d3fde8dc48d76961588d5df45981a2d',
    '0c06448e.bin': 'd1294ef7a57e0d3790ca76a8f5d428148833b2e8641a732220f9aadaba5ffeba',
    '0c06448f.bin': '01f5b06f8af205ef300c11ebf0d80c8b671d7351ef4588ba18336d4954e5776b',
    '0c064490.bin': '1c7ab35320669517373f9f382960b869200f1573474129436c55f064b71911d0',
    '0c064491.bin': '07bf4ec88c6f84c69bee677e444e244a1cf011d2028207a2d7fb3434910c3a96',
    '0c064492.bin': 'c8b90b9735ec2ad787736e2e335a64ee4e101a2f33618ee0dbef3a9ad61324a4',
    '0c0644de.bin': '1e0b28f388daab88b59c9675a35668fc9f5e0a8f01e28f992e27201d1fdbb2bc',
    '0c0644df.bin': '3f04eac13964b97db13254914e60eb2c71ee7b4b712af85c602af38af05bc3ee',
    '0c0644e0.bin': 'cbe9ac21c4e0000ae6a05ce24fb99513e409d745bab6de229645a351adf8d7bb',
    '0c064497.bin': 'bf149ae40789021bb1e4e0cf8f8a2164ba88477398eec5e1fa1aa6b4f1ac1874',
    '0c064498.bin': '94d136bd1871f234ebc103ad2f16f3f318e4919157f7d9ae47f63e4e91d65399',
    '0c064499.bin': '5b261ec789a493eecc20e2c1e0befa8da791d5f866f41f162d4e2290279e97b7',
    '0c0644c5.bin': 'd41c6818fe6d9c523a1f018e38ea5abeccff4be0a17ecb6a383fc5aae969e84f',
    '0c0644e2.bin': '6137fcdba95705e13db0d6ec7c4bdb0384874e4c5cc60c99efee433ff874da06',
    '0c064496.bin': '1929bc640b122b44cd0bb1670eb4f20bd76b63ad466e84f207c7de826afd151c',
    '0c06449b.bin': '079e6fe48f280717ca0efdbfc880df921e93b10b682e0d14d4694d91822f15b2',
    '0c06449c.bin': 'd29805e5ad9028d236f58eb2e74d4f6a8ee24eab62b237497d8a65a94540fa67',
    '0c0644be.bin': '3499e75b98435ea9b6383720563e251baa0ac7f277e93a3d677905ef78c727d7',
    '07670041.bin': '88e9d1ae998dd22ee87cd981cb6fdf96d3ca1737ef4f49ca45bcc5ad3f446503',
    '07670042.bin': 'cbea7b0aa328a0213f30e37e6c90dc585f70b9262196b8437f613c37a432fa2f',
    '076e0ec1.bin': '4cd9b5fe4075ccaa536a80e28d665e8dec15c4fc68f28183a8c1170f9e3c96e3',
    '076e0ec2.bin': 'e86dd1668d6efa074bb21f4cf4da0398f9504e63889b1592a09cc82437a940c0',
    '076e0f01.bin': '7ff808e1feb31ef78dc0883e1a53aa6045a394781502077b67535f5c4256f6fc',
    '076e0f02.bin': '99d4e0d1b474e94ca35859e4f1f296d6ada945ae29d69a93a03723e155aad24b',
    '07671201.bin': '1729f9dbccdec52f74fe39c73fd4bbb0d3c76c7dd4609f43bd5ce6057f382362',
    '07671202.bin': 'ca5df3ccc8041fb648333e42333162684672f6a9e2b75d5449af843fd0c7fced',
    '07670ac1.bin': 'f014d06697ddd606b73ffdacd5f4af30028702840ca5d767438752cfa7091a0e',
    '07670ac2.bin': '96c761aab09769bc1338fe1497085e2ddaaefbd95ceac18a6a619173c771623c',
    '076e0a81.bin': '88015e97a43bec9d299b72394405bd75e6ad52cf8399897f9c4364911dee115a',
    '076e0a82.bin': 'e77a8d466aa7863f3f46e6e36ad55c81e8d7ecfebd846d3dd5e064a6aca93af4',
    # (export_web_stage.py, worker 0219; scr001 and 0c064205 are listed above)
    '0c064000.bin': '35e05261dc10f02939fc0c075bbad21836c39b6323403eea3a2cfd2f58ab1fb4',
    '0c064002.bin': 'd1f37fd6e9190e7145eaf82bed052673378876840b82f1c09fdba37070346eb4',
    '0c064003.bin': '583e136ff6ef2401aca2749d91a183c2f4874bac30b9d5e9271ae2f0aeff5e73',
    '0c064004.bin': 'f4582605317758fb6a2ab446005bef7e2ebe3b532460e715c51f3f70a1375e69',
    '0c064005.bin': 'c577b21c91581934bac5b4178da4866c6390fa13a18d1d9337432441e73156f2',
    '0c064006.bin': '04657223c085c7c531a22e28928fd1b7796f001b709d7ff6ced877eb5b2bbe81',
    '0c064007.bin': 'aacd3f17aabd14684a4f11b6c4b5b8e51de3ae8c26ded902a5befcf858117700',
    '0c06420a.bin': '75e05c527c74ead6c678fef955567ca1969755f4a6a225af8d386ea4ffbec1c3',
    '0c06420b.bin': 'cbaafd8125e7ade2975752df6ba3c90808ee863f723b2c50ef674b67407e72e4',
    '0c06420c.bin': '6ed7ab7e872ec24d1ec54d8844e11cfabfec546e6b901a68747a259aaf17f980',
    '0c06420d.bin': 'e7d056c3c79fdc893c8d6b4ba788a371fcef06321beec52fceec46bdfe2d5536',
    '0c06420e.bin': '133376118637991255b5e98b531477e433655a0e87cc803923f096fd9db56a7c',
    '0c06420f.bin': '0c51e9557d713c12bf7481ab50a235063fc9c4b8ceb60c02b9f6ff41c66aa815',
    '0c064214.bin': '67f88a234cf9814e38add924b1c3c8eb431e85b1ff59d74086aabf1fb3227a42',
    '0c064215.bin': 'f81214cd311fb9f08e8607792f5fddd0fd9f8b2cecf2fcbbbc6c2e80a7a8d446',
    '0c064216.bin': '2dc58d1515ff82c805d292a8269ee5dc1d4f5f07b5dec19d2cae5c910382f4ae',
    '0c064217.bin': '67762f3f34dd7cf4adc0f9c9102dd82eabc25d73d5d1cb659ed199a22302ddd4',
    '0c064218.bin': '0d05800f72cd5c836a1578dbd2d1fe4b3a37512a549483942345397e775059f3',
    '0c064219.bin': '1f12b78c451716e7f8c063ced2204ddcc5bd1202d133ed9ccddcd8eb45b3f570',
    '0c06421a.bin': 'c28791daf506fcb5fb93bbcf9929e59fd34df5598df141cd872e2f5b9b31b179',
    '0c06421b.bin': '1ec12cbabde7f8d28bf21c17e255ff5dfac8ee23ccaf0022acdef26997698588',
    '0c06421c.bin': '8c0566d17d6616bf5b971f916d97a83b43657ea83d770d13c104a09d4b2a7424',
    '0c06421e.bin': '02f5862b004ea5bd48ab9131491d1bd28f90ef8fdbec7d8fcd4fa309a60de9f6',
    '0c06421f.bin': 'aa71f4baa9f5945e0bd18ae06e9cc3267db93bccc9e7509374bf7a20419dd7fe',
    '0c064220.bin': 'b2b04a0dadbe1a327c7e5ed4b3a0a0900dac21335558ab762f2e3ba709184460',
    '0c064221.bin': '0c1bc02bc250806e59c17aae95f1e8e8351298b31b7ec216bd62acbb4720fea8',
    '0c064222.bin': 'bd6404bef3ff577ee3464773b691745d635e6ec5c7d4d48a74a137dd2c679c93',
    '0c064223.bin': '6fb60691ee288316d98b373c12c05bdfee6ebfd55f36ac65aa933e07f1ff5906',
    '0c064224.bin': '7d74ff45e0782773123cf5a477648bbd317c0d2e841e1016bbc11defa7f771ee',
    '0c064225.bin': 'dd786b2d3a1e01bba1c60f8f98611422d6aad8a4261bf8fc5725313958604e01',
    '0c064228.bin': 'd9fd958687c3e9f8ce146721f0ea68406210c102083abe0398134c3ab0965717',
    '0c064229.bin': '89ba673221cded09f59072da8c0fd7a34b0d087e928c0ad2b48f199a6c44ee55',
    '0c06422a.bin': '760b18eb64fe0ec1177c811ea8acc7a770bffb6a0e16f482ca7447945d732417',
    '0c06422b.bin': '7d33eedc081e385bf86c0b5f5c81a1c09bc82ef6aca667d327aa4f80009bf98d',
    '0c06422c.bin': '668695eaee1c012e5c91cfdd0360ee8b5eafe9c8552626611fc76f82faf0b76f',
    '0c064278.bin': '3e4971008f7bc795289ad066896643a7eed43fb843915e661f4e35697ff56126',
    '0c064279.bin': 'f4463c072e8a6813c8e1a0b0127375ad843dcf90fac90f9617d5fa76e28055df',
    '0c06427a.bin': '1af1ffa587f2d7c37459a2fddfe06e9a50117da931224861c6df486a6eb86af1',
    '0c06427b.bin': '23df6295fe979f7aa7cd117f5abd737947ea27d4ac0e297cb9cca7a3a517b5fa',
    '0c06427c.bin': 'fc4b48da96d40ee1fef2e505e2c325887ede4c0e788e03a641e0608e1ccb7f71',
    '0c06427d.bin': '0228d9677cc24a4869e6d17f145686d134a855e5fd5768cfe9782d3336a42693',
    '0c06427e.bin': '23d33b3726dfa6cf0d152921ea02ac41a5de7adf208586b2eadc2eaa7d394271',
    '0c06427f.bin': '88fbc90a64976a813e93b5482403011cb2511cd5e045ca2f5dbe8ea068d04663',
    '0c064280.bin': '9184e9432eaddbabff6f5e1842a62f9300c027fc18ba94a787b3b9d7ab92ed7b',
    '0c064282.bin': '796735523724e9d06abfbae16dae0b1b6e949dfaeff04075a2e90d6c91f7607f',
    '0c064284.bin': 'd0142f701d7de1bd637ddd7ed231781459d3cd5ada79446898b12d861a290913',
    '0c064285.bin': 'b622d87dd5cd528f4d2fd7bac02adc636d59c1a0485a53aa986880a403fda7a4',
    '0c064286.bin': 'b1389d12d8604ec36b04061ff6df214ad70233de1caec893a67ad56d1b8f7df9',
    '0c064287.bin': '3fa19af4bb9f80ecf22d70e325934099e53be2f2d3cd64f33310df182e3114a7',
    '0c064288.bin': 'af1411d06c4dcc18b019ad38d0433c2fe414cf4ffcf3185dfaf0913b95c9145a',
    '0c064289.bin': '3d66ce9312b348cd2a0ea398227188586f850522247c2f3f51d3fdc4a5247d4f',
    '0c06428a.bin': 'c70dbad4fab53f8643bf677034f8fa6040f8058f9a3c440c0e8a8aa698574100',
    '0c06428b.bin': '8e887cb8f5c7af48bc0b54e8e46338cc450ddf1cc0e4ac07ff6f9bdbc99eba82',
    '0c06428c.bin': '891fceeacb81ad9e471719686b3cc11eab45f5d5e3bcf835346c25b8ef891407',
    '0c06428d.bin': '417e1127aa3681e32a315a705b6d612d7d13c41c12dc050ee53816a5b84fefb1',
    '0c06428e.bin': '7c8f42c4df07b24b9d1df56906a5d40af47765740e6158cec5a0536fdf1729d2',
    '0c06428f.bin': 'd58d46a0ead2f83dfe1f69706df7cba29437eff7956432c9dc0e4ca8c532261a',
    '0c064400.bin': 'c74099cba44ad1eecaf611e8615415a41aeeadaa5ef563b86f5b606e52b0039a',
    '0c064401.bin': 'e128959c63fbd3640d03629bec059e7ec39e68e3eb9b6571a6395a9380fb67bf',
    '0c064402.bin': 'a716f42197442e7328dd7b38991fc09b09ff34f3f23fa7fb14a96f4e31ad4de6',
    '0c064403.bin': '7a0335a29ce376a2b8d1629a554b0514f5ff8928d13bdfacd800d1ac42f6042e',
    '0c064404.bin': 'c7852a87b94be09d779c6e5a3346bdbb6ecfb5e2a2000ef9a4ed8b29665a03ef',
    '0c064405.bin': '86c2e2c2df92db05099572113ed1476329cfcb8c6eb808c0773318fa94d02514',
    # the opening event's actors: scr001's other motion files and its models p005 / g013 / e063 / n013 / g000 / p014
    # (export_web_event_actors.py, worker 0218)
    '0c06441d.bin': '41372ed0a2baffe6b72db1b30e33a4afea80622d1f39d30d25e6cfce82494f80',
    '0c064422.bin': 'c57f07fc4e5bf053f58f3e5d4e28d26916054ec7d0c4b58306e3b283c9ccc5a5',
    '0c0644c6.bin': 'c932e42809a879e378dad26ba50e57408af25c843b7a9a33d5b86d66d04cf7eb',
    # rv_matiawase's p000 motion files loadmotion(13) / (123) (export_web_event_actors.py, worker 0248)
    '0c06440d.bin': '8b6515d69ef1e339ff9b21d9145ef3492659c6e65e12389c98b9118a162926a5',
    '0c06447b.bin': 'd9e3240f9d37cf5e60cd49ba45e66c71f51ad94bca4d6f25547deb8551d69851',
    '0c0644fe.bin': '4bff4c03a6ff6891732856814e068dd8cab37eaebbaa0ca130243b9daae8eb6c',   # the opening's p000 loadmotion(254) (worker 0248)
    '07700141.bin': '8e39417027c58f7d3adbd49c439cc48e72d9edd0733f034be948c5f714f3103c',
    '07700142.bin': '48642817f47dda6249601cfd68727bc9883bef3eccc58ad414d8a4bcfe440844',
    '07670341.bin': '95afdc7eee628ac4fafdb533aade5e662fc6b893fde57ae5013f642cb6a5e883',
    '07670342.bin': '1a889e116f853c7a80b3f608bb9865ae29303d82a6d08340c6713e9f8e9e4bf3',
    '07650fc1.bin': '78192811ac0592f38bbeaeb674f147203b4b02a45ea45ad02d6e52146c548ba9',
    '07650fc2.bin': 'b86f9b9a00bc0b376d49197e590351377fe32a459358fd0183e1b2da1f816b32',
    '076e0341.bin': '4f0b321245d35b20442a296d80112d16c52582bd02a530d32c9c04201fc42e09',
    '076e0342.bin': '1a77b5bdbcc030cbdb134931dab8897e923511e1c4214ccefe321228cbbd81b5',
    '07670001.bin': '77a91ce9829dd6a41bd3ec9ef50099c0c464b72dfac22600ab67a303bfd9e037',
    '07670002.bin': '7078772714c60e7fe78f33e2f8e121cadbb74883746aa8c02edef383dba1b051',
    '07700381.bin': '46ea22d2c243b639a4fc36fb5a0f3d9e5803fd0f1821c5203edc402b9c1a4f0e',
    '07700382.bin': '45bc8fcebcd52b02a5ec625134e0367b5549afc9b1b5453615237e325361ce9b',
    # z128 townspeople / WRO men (worker 0223): model, textures, the stance row-0 idle + the scripts' cmd 0x141 clips (export_web_enemy.py)
    '076e0441.bin': '2c977c779591055cfdbcc0ba9f101987092a6afffe2594140c52281fd9bc6d23',   # n017 model
    '076e0442.bin': '1cc4117f8e07874d4f38a8c978a231974579299fe66978d361b7db9fccd7d343',   # n017 textures
    '076e044b.bin': 'f41bf7ffadb6c57bc1a0c288744207355ffaf46fe55fb2f61c02baa5607702f8',   # n017 clips k=0xb (r_gst, r_gst_lk, r_look)
    '076e0481.bin': '5ae1e3fbed5ed0e59e11085214f1d13e737c70f409c1bccf8e452414ffb6f728',   # n018 model
    '076e0482.bin': 'f1f882466eb62271928589efc4d223202f57b1275e63b8c7cb4f8a8c65605c62',   # n018 textures
    '076e048b.bin': 'e0d94acb79ab560ddc0aba450530d2f3fe76039c9f7e8e643278521a9ee45bcb',   # n018 clips k=0xb (r_gst, r_gst_lk)
    '076e0580.bin': 'd2ec95352dd9fba039d1620a626fe4c317b20d459cf84afe3794fe68203c59f1',   # n022 clips k=0x0 (m_look)
    '076e0581.bin': 'cd0833becadefa262a9d4ec08b881b91292c03294540acfbf28343021e8bdcd3',   # n022 model
    '076e0582.bin': '78c8b6e70b1122ba4578848a49ce2ee23675c6d15cbbed9c5dfdb42c1a42cff6',   # n022 textures
    '076e058b.bin': 'f41bf7ffadb6c57bc1a0c288744207355ffaf46fe55fb2f61c02baa5607702f8',   # n022 clips k=0xb (r_gst)
    '076e05c0.bin': 'fab8f326c4262a6b8cf99ddd5097837f3d055595e091dd7f5d4fa736b7d9f490',   # n023 clips k=0x0 (st, breath1, fear)
    '076e05c1.bin': 'a3bdb2874870b31d7b382c59226013670169714a0f4391b1cbca57ec6c24d0f2',   # n023 model
    '076e05c2.bin': '38d8e0402bae4369b68ad767a90ef4d3e0ebabc0715e4c8a8f3a5bcaa3153634',   # n023 textures
    '076e0600.bin': 'd80d90d417a0464d7cdc31ff5fcf4aa193fced053e0eafc33f00834dcc44eda6',   # n024 clips k=0x0 (st, fear, fear2, fear3)
    '076e0601.bin': '4a3160a8fc295f1dba4192caca88615a3a453a3df9c5c0a2e52fe6ba668e62dc',   # n024 model
    '076e0602.bin': '703ece722e880a8d68c10cf7bfd5a00f0d6abee1d6e7c2a063fe9f18665a1ceb',   # n024 textures
    '076e0640.bin': 'fab8f326c4262a6b8cf99ddd5097837f3d055595e091dd7f5d4fa736b7d9f490',   # n025 clips k=0x0 (st, fear)
    '076e0641.bin': 'e2863e88816b3e3c4ff2bc80f7eb10a3008c06d5dad6f8188a2860c3202be66e',   # n025 model
    '076e0642.bin': '3e1f39c6317a5564affcc816b787551feed220de82145621359b41420a0e863e',   # n025 textures
    '076e0680.bin': 'd80d90d417a0464d7cdc31ff5fcf4aa193fced053e0eafc33f00834dcc44eda6',   # n026 clips k=0x0 (st, fear, fear3)
    '076e0681.bin': 'bb91f4fc54ff6c77dc5d5d06c014396d390b77c4e7d4cd426feb8d350b3f7854',   # n026 model
    '076e0682.bin': '4208e1e68dcbf313f9669a05f049c8aa1c7de21cf2233e3b920c29ede82e32f0',   # n026 textures
    '076e0740.bin': 'fab8f326c4262a6b8cf99ddd5097837f3d055595e091dd7f5d4fa736b7d9f490',   # n029 clips k=0x0 (st, fear)
    '076e0700.bin': '35f291a8b10e54f0915e186d6e5415ccd368cc722695ca2874b98c0399195f91',   # n028 clips k=0x0 (st)
    '076e0701.bin': 'e1adb1647c701e839e6f250f3959029692a4fcf34bf04a6d8091a510edf32e33',   # n028 model
    '076e0702.bin': '44d8714bb7e381b89075271cdc0b9b5a68ffbdec1dbcf9d9070541e20f2f40b3',   # n028 textures
    '076e0741.bin': '95baa304279401b4dccb5efeaa9b9fc9c064a11429dee8b33be7762fdfbf75b6',   # n029 model
    '076e0742.bin': '1256f134826a5cce73c1b845b3cdf472c221b4a0630e5c1adc12a9626fb45782',   # n029 textures
    '076e0780.bin': 'd80d90d417a0464d7cdc31ff5fcf4aa193fced053e0eafc33f00834dcc44eda6',   # n030 clips k=0x0 (st, fear)
    '076e0781.bin': '02e127b8190ea2b345d0f86f678272f6f8102bb74d93255096546de71a68c4ab',   # n030 model
    '076e0782.bin': 'eb88a792d644e5d781af8c498b8dffa3954fb13ea3ceca3aa99e37edf55a3abb',   # n030 textures
    '076e07c0.bin': 'fab8f326c4262a6b8cf99ddd5097837f3d055595e091dd7f5d4fa736b7d9f490',   # n031 clips k=0x0 (st, breath2)
    '076e07c1.bin': '90823f35c34b021e8889ee4ec69b06f34988c92de14989b16efc7dc5b79736ef',   # n031 model
    '076e07c2.bin': 'b79c12c288577e3a802e65c53fc9455218f75ff4160d63fc86f48ba1a23c080d',   # n031 textures
    '076e0800.bin': 'd80d90d417a0464d7cdc31ff5fcf4aa193fced053e0eafc33f00834dcc44eda6',   # n032 clips k=0x0 (st, fear)
    '076e0801.bin': '0793ee1a478f28c4b0e2d6901783d0ad3ff344708f3a16d267a234aeb3bdfc89',   # n032 model
    '076e0802.bin': '50c934972bad22a122d2e5c19ce62d00d11258cff8718377bc6f9230158e6a91',   # n032 textures
    '076e0840.bin': '4722531961c7cc219a3c06669770bc1efdcf74f949dcee82792bd592fb93067e',   # n033 clips k=0x0 (st, fear)
    '076e0841.bin': 'd7fe5736fc8474a373740b2ca828f66b2716d63a1b65975ad52702ae1169b825',   # n033 model
    '076e0842.bin': '3380db8775e497b41c45b979837da9ce84ba5e1ab5004d09ea4471bc9c6b453d',   # n033 textures
    '076e0880.bin': '35f291a8b10e54f0915e186d6e5415ccd368cc722695ca2874b98c0399195f91',   # n034 clips k=0x0 (st, fear)
    '076e0881.bin': '91b5ae3ed7336ed2a5393c6d9aa7403cb858547fca562fab51edd55c88cd86bd',   # n034 model
    '076e0882.bin': 'f1c9af6ce3384f615be7c2db6e2f71bd863347485cfe5cf767397717525ab638',   # n034 textures
}


def die(msg, code=1):
    print('disc.py: ' + msg, file=sys.stderr)
    sys.exit(code)


class Iso:
    """Minimal ISO 9660 reader: primary volume descriptor + directory records."""

    def __init__(self, path):
        self.path = path
        try:
            self.f = open(path, 'rb')
        except OSError as e:
            die(f'cannot open {path}: {e}')
        self.f.seek(16 * SECTOR)
        pvd = self.f.read(SECTOR)
        if len(pvd) < SECTOR or pvd[0] != 1 or pvd[1:6] != b'CD001':
            die(f'{path}: not an ISO 9660 image (no primary volume descriptor). '
                'Use a plain .iso (2048-byte sectors); convert .bin/.cue, .mdf, .nrg or .chd first.')
        self.volume_id = pvd[40:72].decode('ascii', 'replace').strip()
        self.root = self._record(pvd[156:156 + 34])

    @staticmethod
    def _record(r):
        n = r[32]
        return dict(lba=struct.unpack_from('<I', r, 2)[0], size=struct.unpack_from('<I', r, 10)[0],
                    dir=bool(r[25] & 2), name=r[33:33 + n].decode('ascii', 'replace').split(';')[0])

    def listdir(self, ent):
        self.f.seek(ent['lba'] * SECTOR)
        data = self.f.read(ent['size'])
        out, o = [], 0
        while o < len(data):
            ln = data[o]
            if ln == 0:                                # records don't cross sectors
                o = (o // SECTOR + 1) * SECTOR
                continue
            r = self._record(data[o:o + ln])
            if r['name'] not in ('\x00', '\x01'):
                out.append(r)
            o += ln
        return out

    def find(self, path):
        ent = self.root
        for part in path.split('/'):
            hit = [e for e in self.listdir(ent) if e['name'].upper() == part.upper()]
            if not hit:
                return None
            ent = hit[0]
        return ent

    def read(self, ent):
        self.f.seek(ent['lba'] * SECTOR)
        return self.f.read(ent['size'])

    def copy(self, ent, dst):
        """Stream a file out of the image; returns its SHA-256."""
        h = hashlib.sha256(); left = ent['size']
        self.f.seek(ent['lba'] * SECTOR)
        tmp = dst + '.part'
        with open(tmp, 'wb') as o:
            while left:
                b = self.f.read(min(left, 8 << 20))
                if not b:
                    die(f'{self.path}: image is truncated (reading {dst})')
                o.write(b); h.update(b); left -= len(b)
        os.replace(tmp, dst)
        return h.hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(8 << 20), b''):
            h.update(b)
    return h.hexdigest()


def check(iso_path, quiet=False):
    iso = Iso(iso_path)
    cnf = iso.find('SYSTEM.CNF')
    if cnf is None:
        die(f'{iso_path}: no SYSTEM.CNF, so this is not a PS2 game disc')
    cnf_text = iso.read(cnf).decode('ascii', 'replace')
    if BOOT_ID not in cnf_text:
        boot = [l for l in cnf_text.splitlines() if 'BOOT' in l.upper()]
        die(f'{iso_path}: wrong disc. It boots {boot[0].strip() if boot else "?"}; '
            f'the supported disc boots {BOOT_ID} (PAL Europe/Australia). See docs/BROWSER.md.')
    got = {}
    for name in KNOWN:
        if name == 'E419C51B/KEL.DAT':
            continue                                    # 1.5 GB: hashed while extracting
        ent = iso.find(name)
        if ent is None:
            die(f'{iso_path}: {name} is missing; the image is incomplete or damaged')
        got[name] = hashlib.sha256(iso.read(ent)).hexdigest()
    if iso.find('E419C51B/KEL.DAT') is None:
        die(f'{iso_path}: E419C51B/KEL.DAT is missing; the image is incomplete or damaged')
    bad = [n for n, h in got.items() if KNOWN[n] and h != KNOWN[n]]
    if not quiet:
        print(f'disc: {BOOT_ID}, volume "{iso.volume_id}", {os.path.getsize(iso_path):,} bytes')
        for n, h in got.items():
            print(f'  {n:18s} {h}  {"ok" if KNOWN[n] == h else ("MISMATCH" if KNOWN[n] else "(no reference)")}')
    if bad:
        die(f'{iso_path}: {", ".join(bad)} differ from the supported disc (different revision, '
            'or a damaged/patched image). The build only supports the reference files.')
    return iso


def extract(iso_path, work):
    iso = check(iso_path)
    os.makedirs(work, exist_ok=True)
    for name, out in (('FILELIST.BIN', 'FILELIST.BIN'), ('E419C51B/KEL.DAT', 'KEL.DAT')):
        dst = os.path.join(work, out)
        print(f'  copying {name} -> {dst}', flush=True)
        h = iso.copy(iso.find(name), dst)
        want = KNOWN[name]
        if want and h != want:
            os.remove(dst)
            die(f'{name}: SHA-256 {h} does not match the supported disc ({want}). '
                'The image is damaged or a different revision.')
        print(f'  {name:18s} {h}  {"ok" if want == h else "(no reference)"}')


def elf(iso_path, dst):
    """Copy the game's ELF out of the image for the exporters that read tables (and the BGM / string
    keys) from it at run time. build_web.sh deletes the copy when it finishes."""
    iso = check(iso_path, quiet=True)
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    ent = iso.find(BOOT_ID)
    if ent is None:
        die(f'{iso_path}: {BOOT_ID} is missing; the image is incomplete or damaged')
    h = iso.copy(ent, dst)
    if h != KNOWN[BOOT_ID]:
        os.remove(dst)
        die(f'{BOOT_ID}: SHA-256 {h} does not match the supported disc')


def verify(nopath, quiet=False):
    """Check every input file the build reads. Returns the list of problems."""
    probs = [] if INPUTS else ['no input list in disc.py (INPUTS is empty)']
    for name, want in sorted(INPUTS.items()):
        p = os.path.join(nopath, name)
        if not os.path.isfile(p):
            probs.append(f'missing {name}')
        elif sha256_file(p) != want:
            probs.append(f'hash mismatch {name}')
    if not quiet:
        print(f'inputs: {len(INPUTS) - len(probs)}/{len(INPUTS)} ok' + ''.join('\n  ' + x for x in probs))
    return probs


def main(argv):
    if len(argv) < 2:
        die(__doc__, 2)
    cmd = argv[0]
    if cmd == 'check' and len(argv) == 2:
        check(argv[1])
    elif cmd == 'extract' and len(argv) == 3:
        extract(argv[1], argv[2])
    elif cmd == 'elf' and len(argv) == 3:
        elf(argv[1], argv[2])
    elif cmd == 'verify' and len(argv) == 2:
        sys.exit(1 if verify(argv[1]) else 0)
    elif cmd == 'isohash' and len(argv) == 2:
        h = sha256_file(argv[1])
        print(h, 'matches the reference image' if h == REFERENCE_ISO_SHA256 else
              'differs from the reference image (fine if `check` passes: padding/rip differences)')
    else:
        die(__doc__, 2)


if __name__ == '__main__':
    main(sys.argv[1:])
