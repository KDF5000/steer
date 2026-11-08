#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cache="$root/.cache/asr"
revision=6a8addd258eadd6563f8c582e8acc535e6325364
source_dir="$cache/whisper.cpp-$revision"
mkdir -p "$cache"
verify() { printf '%s  %s\n' "$2" "$1" | shasum -a 256 -c - >/dev/null; }
if ! verify "$cache/source.tar.gz" a6ac09ab065d65ad51e27e6dc7e44560d8d138b591840ff0461a8f7dbc48d774 2>/dev/null; then
    curl -fL --retry 2 "https://github.com/ggml-org/whisper.cpp/archive/$revision.tar.gz" -o "$cache/source.tar.gz"
    verify "$cache/source.tar.gz" a6ac09ab065d65ad51e27e6dc7e44560d8d138b591840ff0461a8f7dbc48d774
fi
if [[ ! -d "$source_dir" ]]; then tar -xzf "$cache/source.tar.gz" -C "$cache"; fi
if ! verify "$cache/ggml-tiny-q5_1.bin" 818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7 2>/dev/null; then
    curl -fL --retry 2 "https://huggingface.co/ggerganov/whisper.cpp/resolve/f281eb45af861ab5e5297d23694b7d46e090c02c/ggml-tiny-q5_1.bin" -o "$cache/ggml-tiny-q5_1.bin"
    verify "$cache/ggml-tiny-q5_1.bin" 818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7
fi
if ! verify "$cache/ggml-base-q5_1.bin" 422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898 2>/dev/null; then
    curl -fL --retry 2 "https://huggingface.co/ggerganov/whisper.cpp/resolve/f281eb45af861ab5e5297d23694b7d46e090c02c/ggml-base-q5_1.bin" -o "$cache/ggml-base-q5_1.bin"
    verify "$cache/ggml-base-q5_1.bin" 422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898
fi
build_slice() {
    local sdk="$1" triple="$2" architecture="${3:-arm64}" build="$cache/build-$1"
    if [[ "$architecture" != arm64 ]]; then build="$build-$architecture"; fi
    cmake -S "$source_dir" -B "$build" -G Ninja \
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_SYSTEM_NAME=Darwin \
        -DCMAKE_SYSTEM_PROCESSOR=arm64 -DCMAKE_OSX_ARCHITECTURES="$architecture" \
        -DCMAKE_OSX_SYSROOT="$sdk" -DCMAKE_C_COMPILER="$(xcrun --find clang)" \
        -DCMAKE_CXX_COMPILER="$(xcrun --find clang++)" \
        -DCMAKE_C_FLAGS="-target $triple" -DCMAKE_CXX_FLAGS="-target $triple" \
        -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY -DBUILD_SHARED_LIBS=OFF \
        -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=OFF -DWHISPER_BUILD_SERVER=OFF \
        -DGGML_METAL=OFF -DGGML_BLAS=OFF -DGGML_ACCELERATE=ON \
        -DGGML_OPENMP=OFF -DGGML_NATIVE=OFF
    cmake --build "$build" --target whisper -j 6
    xcrun --sdk "$sdk" clang++ -target "$triple" -isysroot "$(xcrun --sdk "$sdk" --show-sdk-path)" \
        -std=c++17 -O3 -I "$source_dir/include" -I "$source_dir/ggml/include" \
        -c "$root/Native/SteerLocalASR.cpp" -o "$build/SteerLocalASR.o"
    xcrun libtool -static -o "$build/libSteerLocalASR.a" "$build/SteerLocalASR.o" \
        "$build/src/libwhisper.a" "$build/ggml/src/libggml.a" \
        "$build/ggml/src/libggml-base.a" "$build/ggml/src/libggml-cpu.a"
}
# Device slices are sufficient for the physical Watch validation. Pass --simulators
# to also support Apple Silicon iPhone/Watch simulators; they are not speed tests.
build_slice watchos arm64-apple-watchos10.0
build_slice watchos arm64_32-apple-watchos10.0 arm64_32
build_slice iphoneos arm64-apple-ios17.0
mkdir -p "$cache/build-watchos-universal"
xcrun lipo -create "$cache/build-watchos/libSteerLocalASR.a" "$cache/build-watchos-arm64_32/libSteerLocalASR.a" \
    -output "$cache/build-watchos-universal/libSteerLocalASR.a"
args=(-library "$cache/build-watchos-universal/libSteerLocalASR.a" -headers "$root/Native"
      -library "$cache/build-iphoneos/libSteerLocalASR.a" -headers "$root/Native")
if [[ "${1:-}" == --simulators ]]; then
    build_slice watchsimulator arm64-apple-watchos10.0-simulator
    build_slice iphonesimulator arm64-apple-ios17.0-simulator
    args+=(-library "$cache/build-watchsimulator/libSteerLocalASR.a" -headers "$root/Native"
           -library "$cache/build-iphonesimulator/libSteerLocalASR.a" -headers "$root/Native")
fi
if [[ -d "$cache/SteerLocalASR.xcframework" ]]; then rm -r "$cache/SteerLocalASR.xcframework"; fi
xcodebuild -create-xcframework "${args[@]}" -output "$cache/SteerLocalASR.xcframework"
cp "$source_dir/LICENSE" "$cache/WHISPER-LICENSE.txt"
echo 'Local speech dependencies prepared. Run xcodegen generate --spec apple/project.yml.'
