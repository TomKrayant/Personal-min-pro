# Third-Party Notices / 第三方说明

This is an unofficial fan-made desktop pet. It is not affiliated with or
endorsed by DeepSeek, the Nekojishi developers, or the owners of Linhu.

这是一个非官方同人桌宠，与 DeepSeek、Nekojishi 开发组及林虎权利方均无隶属关系。

## 1. Character and reference artwork

- Character: Linhu / 虎爷 from *Nekojishi / 家有大猫*.
- The pet image in `linhu-pet/assets/linhu.png` is derived from the reference
  image supplied by the project owner.
- Copyright and other rights in the character and artwork belong to their
  respective rights holders.
- This project does not grant a license to the character or artwork. Do not
  use it commercially. Obtain permission before publishing or redistributing
  the character image publicly.

## 2. Electron runtime

- The packaged `LinhuPet.exe` and the files under `locales/`, `resources.pak`,
  `*.dll`, `*.pak`, `icudtl.dat`, `snapshot_blob.bin`,
  `v8_context_snapshot.bin`, and `resources/default_app.asar` are a copy of the
  Electron runtime shipped with the locally installed DeepSeek Harness
  Desktop application.
- Electron is licensed under the MIT License. The full Chromium/Electron
  license text is included as `LICENSE.electron.txt` and
  `LICENSES.chromium.html`.
- DeepSeek Harness and its marks belong to DeepSeek. The copied executable is
  used here only as an application runtime. This project is not endorsed by
  DeepSeek. Before publishing a binary that includes this runtime, verify that
  you have the right to redistribute it; otherwise publish source only and
  let users build locally from their own DSH installation.

## 3. No network assets

The final build does not contain downloaded third-party art packs or
network assets. Only the supplied reference image was processed into
`linhu.png`; the build scripts read the local DSH installation.

## 4. Data and privacy

The pet reads local DSH session logs under `%USERPROFILE%\.dsh\sessions`.
It does not upload logs, credentials, tokens, or prompts. It stores its own
window position and cache under `%APPDATA%\LinhuPet`.
