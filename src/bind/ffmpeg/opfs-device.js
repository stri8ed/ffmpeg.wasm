/**
 * Custom OPFS Device for FFmpeg.wasm (Legacy FS Compatible)
 *
 * This allows mapping an OPFS FileSystemSyncAccessHandle to a virtual file/device
 * in the Emscripten file system. This enables direct writing to OPFS without
 * buffering the entire file in WASM memory.
 */

Module["registerOpfsFile"] = function(path, accessHandle) {
    // Ensure we have the file system (should be available in runtime)
    if (typeof FS === 'undefined') {
        console.error("FS not initialized.");
        return false;
    }

    try {
        // Generate a unique device ID
        const major = 80; // Custom major number
        // Use a hash of the path or a random number for minor, but sequential is safer
        // ensuring no collision if called multiple times.
        // For simplicity, we just use a static minor for now or increment.
        if (!Module["_opfs_device_minor"]) Module["_opfs_device_minor"] = 0;
        const minor = ++Module["_opfs_device_minor"];

        const device = FS.makedev(major, minor);

        // Register the device
        FS.registerDevice(device, {
            open: function(stream) {
                // Optional: Seek to start or end depending on mode?
                // For now, we assume standard behavior.
                return 0;
            },
            close: function(stream) {
                // We do NOT flush/close the accessHandle here automatically
                // because the user might want to keep it open.
                // Responsibility to close the handle lies with the caller JS.
                return 0;
            },
            read: function(stream, buffer, offset, length, position) {
                // buffer is a Uint8Array (usually a view into the heap)
                // accessHandle.read expects a buffer to read INTO.

                // Create a view for the destination in the WASM memory
                // Emscripten passes 'buffer' as a subarray view of HEAPU8 usually.
                // We need to be careful with copies.

                // The 'buffer' argument in new Emscripten versions is often a typed array.
                // accessHandle.read(buffer, { at: position })

                // We need to copy strictly 'length' bytes.
                // However, accessHandle.read takes a DataView or TypedArray.
                // It reads *into* that buffer.

                // We should use a temporary buffer if we can't pass the 'buffer' directly
                // or if 'buffer' is a view that accessHandle doesn't like.
                // Generally, passing the subarray is fine.

                const bytesRead = accessHandle.read(buffer.subarray(offset, offset + length), { at: position });
                return bytesRead;
            },
            write: function(stream, buffer, offset, length, position) {
                // accessHandle.write(buffer, { at: position })
                const bytesWritten = accessHandle.write(buffer.subarray(offset, offset + length), { at: position });
                return bytesWritten;
            },
            llseek: function(stream, offset, whence) {
                let position = stream.position;
                if (whence === 0) { // SEEK_SET
                    position = offset;
                } else if (whence === 1) { // SEEK_CUR
                    position += offset;
                } else if (whence === 2) { // SEEK_END
                    // We need the file size.
                    const size = accessHandle.getSize();
                    position = size + offset;
                }
                return position;
            }
        });

        // Create the device node at the specified path
        // Split path to ensure directory exists?
        // For simplicity, assume path is in root or existing dir, or just creating a node.
        // FS.mkdev requires the directory to exist.

        const parts = path.split('/');
        const fileName = parts.pop();
        const dirPath = parts.join('/') || '/';

        // Ensure directory exists
        try {
            FS.mkdir(dirPath);
        } catch(e) {
            // Ignore if exists
        }

        FS.mkdev(path, device);
        return true;

    } catch (e) {
        console.error("Failed to register OPFS device:", e);
        return false;
    }
};
