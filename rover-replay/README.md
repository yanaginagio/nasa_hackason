# Jezero Traverse

Perseveranceの左Navcam画像7枚と、ジェゼロ・クレーターの実走行線を再生する36秒のゲームです。経路上の2地点に到達する前にトラブルに対処します。

## 起動

リポジトリのルートで実行し、ブラウザで http://localhost:8417/ を開きます。

```sh
python3 -m http.server 8417 --bind 127.0.0.1 --directory rover-replay
```

画像・地図タイル・データは `assets/` に同梱されています。起動後の外部アクセスやAPIキーは不要です。素材の再取得はネット接続のある環境で `python3 tools/prepare_rover_replay.py` を実行します。

## データ

- [NASA PDS 左Navcam閲覧画像](https://planetarydata.jpl.nasa.gov/img/data/mars2020/mars2020_navcam_ops_raw/browse/)からSol 15〜23の7枚を選び、ファイル名のSCLKで撮影順を確認しています。
- [PDS Rover PLACES](https://pds-geosciences.wustl.edu/missions/mars2020/places.htm)で、同じSite/Driveのうち画像時刻に最も近いローバー位置を使います。撮影位置の近似で、位置記録と撮影の時刻差は `assets/mission.json` に残しています。
- [NASA/JPLのMMGIS走行線](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json)から対象の3区間を使います。ピンは撮影地点の間を走行線に沿って補間します。画像は6秒間隔で切り替わります。
- 背景は[NASA Mars TrekのJezero HiRISE WMTS](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars)です。必要な2タイルを保存し、WMTSのタイルグリッドで走行線と位置を合わせています。
- 通信不安定と車輪の滑りはゲーム用の創作です。
