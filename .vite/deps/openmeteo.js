import { i as __toCommonJS, n as __esm, r as __export, t as __commonJS } from "./chunk-C3fVp-vY.js";

//#region node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/constants.js
var SIZEOF_SHORT, SIZEOF_INT, FILE_IDENTIFIER_LENGTH, SIZE_PREFIX_LENGTH;
var init_constants = __esm({ "node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/constants.js": (() => {
	SIZEOF_SHORT = 2;
	SIZEOF_INT = 4;
	FILE_IDENTIFIER_LENGTH = 4;
	SIZE_PREFIX_LENGTH = 4;
}) });

//#endregion
//#region node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/utils.js
var int32, float32, float64, isLittleEndian;
var init_utils = __esm({ "node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/utils.js": (() => {
	int32 = new Int32Array(2);
	float32 = new Float32Array(int32.buffer);
	float64 = new Float64Array(int32.buffer);
	isLittleEndian = new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;
}) });

//#endregion
//#region node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/encoding.js
var Encoding;
var init_encoding = __esm({ "node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/encoding.js": (() => {
	;
	(function(Encoding$1) {
		Encoding$1[Encoding$1["UTF8_BYTES"] = 1] = "UTF8_BYTES";
		Encoding$1[Encoding$1["UTF16_STRING"] = 2] = "UTF16_STRING";
	})(Encoding || (Encoding = {}));
}) });

//#endregion
//#region node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/byte-buffer.js
var ByteBuffer;
var init_byte_buffer = __esm({ "node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/byte-buffer.js": (() => {
	init_constants();
	init_encoding();
	init_utils();
	ByteBuffer = class ByteBuffer {
		/**
		* Create a new ByteBuffer with a given array of bytes (`Uint8Array`)
		*/
		constructor(bytes_) {
			this.bytes_ = bytes_;
			this.position_ = 0;
			this.text_decoder_ = new TextDecoder();
		}
		/**
		* Create and allocate a new ByteBuffer with a given size.
		*/
		static allocate(byte_size) {
			return new ByteBuffer(new Uint8Array(byte_size));
		}
		clear() {
			this.position_ = 0;
		}
		/**
		* Get the underlying `Uint8Array`.
		*/
		bytes() {
			return this.bytes_;
		}
		/**
		* Get the buffer's position.
		*/
		position() {
			return this.position_;
		}
		/**
		* Set the buffer's position.
		*/
		setPosition(position) {
			this.position_ = position;
		}
		/**
		* Get the buffer's capacity.
		*/
		capacity() {
			return this.bytes_.length;
		}
		readInt8(offset) {
			return this.readUint8(offset) << 24 >> 24;
		}
		readUint8(offset) {
			return this.bytes_[offset];
		}
		readInt16(offset) {
			return this.readUint16(offset) << 16 >> 16;
		}
		readUint16(offset) {
			return this.bytes_[offset] | this.bytes_[offset + 1] << 8;
		}
		readInt32(offset) {
			return this.bytes_[offset] | this.bytes_[offset + 1] << 8 | this.bytes_[offset + 2] << 16 | this.bytes_[offset + 3] << 24;
		}
		readUint32(offset) {
			return this.readInt32(offset) >>> 0;
		}
		readInt64(offset) {
			return BigInt.asIntN(64, BigInt(this.readUint32(offset)) + (BigInt(this.readUint32(offset + 4)) << BigInt(32)));
		}
		readUint64(offset) {
			return BigInt.asUintN(64, BigInt(this.readUint32(offset)) + (BigInt(this.readUint32(offset + 4)) << BigInt(32)));
		}
		readFloat32(offset) {
			int32[0] = this.readInt32(offset);
			return float32[0];
		}
		readFloat64(offset) {
			int32[isLittleEndian ? 0 : 1] = this.readInt32(offset);
			int32[isLittleEndian ? 1 : 0] = this.readInt32(offset + 4);
			return float64[0];
		}
		writeInt8(offset, value) {
			this.bytes_[offset] = value;
		}
		writeUint8(offset, value) {
			this.bytes_[offset] = value;
		}
		writeInt16(offset, value) {
			this.bytes_[offset] = value;
			this.bytes_[offset + 1] = value >> 8;
		}
		writeUint16(offset, value) {
			this.bytes_[offset] = value;
			this.bytes_[offset + 1] = value >> 8;
		}
		writeInt32(offset, value) {
			this.bytes_[offset] = value;
			this.bytes_[offset + 1] = value >> 8;
			this.bytes_[offset + 2] = value >> 16;
			this.bytes_[offset + 3] = value >> 24;
		}
		writeUint32(offset, value) {
			this.bytes_[offset] = value;
			this.bytes_[offset + 1] = value >> 8;
			this.bytes_[offset + 2] = value >> 16;
			this.bytes_[offset + 3] = value >> 24;
		}
		writeInt64(offset, value) {
			this.writeInt32(offset, Number(BigInt.asIntN(32, value)));
			this.writeInt32(offset + 4, Number(BigInt.asIntN(32, value >> BigInt(32))));
		}
		writeUint64(offset, value) {
			this.writeUint32(offset, Number(BigInt.asUintN(32, value)));
			this.writeUint32(offset + 4, Number(BigInt.asUintN(32, value >> BigInt(32))));
		}
		writeFloat32(offset, value) {
			float32[0] = value;
			this.writeInt32(offset, int32[0]);
		}
		writeFloat64(offset, value) {
			float64[0] = value;
			this.writeInt32(offset, int32[isLittleEndian ? 0 : 1]);
			this.writeInt32(offset + 4, int32[isLittleEndian ? 1 : 0]);
		}
		/**
		* Return the file identifier.   Behavior is undefined for FlatBuffers whose
		* schema does not include a file_identifier (likely points at padding or the
		* start of a the root vtable).
		*/
		getBufferIdentifier() {
			if (this.bytes_.length < this.position_ + SIZEOF_INT + FILE_IDENTIFIER_LENGTH) throw new Error("FlatBuffers: ByteBuffer is too short to contain an identifier.");
			let result = "";
			for (let i = 0; i < FILE_IDENTIFIER_LENGTH; i++) result += String.fromCharCode(this.readInt8(this.position_ + SIZEOF_INT + i));
			return result;
		}
		/**
		* Look up a field in the vtable, return an offset into the object, or 0 if the
		* field is not present.
		*/
		__offset(bb_pos, vtable_offset) {
			const vtable = bb_pos - this.readInt32(bb_pos);
			return vtable_offset < this.readInt16(vtable) ? this.readInt16(vtable + vtable_offset) : 0;
		}
		/**
		* Initialize any Table-derived type to point to the union at the given offset.
		*/
		__union(t, offset) {
			t.bb_pos = offset + this.readInt32(offset);
			t.bb = this;
			return t;
		}
		/**
		* Create a JavaScript string from UTF-8 data stored inside the FlatBuffer.
		* This allocates a new string and converts to wide chars upon each access.
		*
		* To avoid the conversion to string, pass Encoding.UTF8_BYTES as the
		* "optionalEncoding" argument. This is useful for avoiding conversion when
		* the data will just be packaged back up in another FlatBuffer later on.
		*
		* @param offset
		* @param opt_encoding Defaults to UTF16_STRING
		*/
		__string(offset, opt_encoding) {
			offset += this.readInt32(offset);
			const length = this.readInt32(offset);
			offset += SIZEOF_INT;
			const utf8bytes = this.bytes_.subarray(offset, offset + length);
			if (opt_encoding === Encoding.UTF8_BYTES) return utf8bytes;
			else return this.text_decoder_.decode(utf8bytes);
		}
		/**
		* Handle unions that can contain string as its member, if a Table-derived type then initialize it,
		* if a string then return a new one
		*
		* WARNING: strings are immutable in JS so we can't change the string that the user gave us, this
		* makes the behaviour of __union_with_string different compared to __union
		*/
		__union_with_string(o, offset) {
			if (typeof o === "string") return this.__string(offset);
			return this.__union(o, offset);
		}
		/**
		* Retrieve the relative offset stored at "offset"
		*/
		__indirect(offset) {
			return offset + this.readInt32(offset);
		}
		/**
		* Get the start of data of a vector whose offset is stored at "offset" in this object.
		*/
		__vector(offset) {
			return offset + this.readInt32(offset) + SIZEOF_INT;
		}
		/**
		* Get the length of a vector whose offset is stored at "offset" in this object.
		*/
		__vector_len(offset) {
			return this.readInt32(offset + this.readInt32(offset));
		}
		__has_identifier(ident) {
			if (ident.length != FILE_IDENTIFIER_LENGTH) throw new Error("FlatBuffers: file identifier must be length " + FILE_IDENTIFIER_LENGTH);
			for (let i = 0; i < FILE_IDENTIFIER_LENGTH; i++) if (ident.charCodeAt(i) != this.readInt8(this.position() + SIZEOF_INT + i)) return false;
			return true;
		}
		/**
		* A helper function for generating list for obj api
		*/
		createScalarList(listAccessor, listLength) {
			const ret = [];
			for (let i = 0; i < listLength; ++i) {
				const val = listAccessor(i);
				if (val !== null) ret.push(val);
			}
			return ret;
		}
		/**
		* A helper function for generating list for obj api
		* @param listAccessor function that accepts an index and return data at that index
		* @param listLength listLength
		* @param res result list
		*/
		createObjList(listAccessor, listLength) {
			const ret = [];
			for (let i = 0; i < listLength; ++i) {
				const val = listAccessor(i);
				if (val !== null) ret.push(val.unpack());
			}
			return ret;
		}
	};
}) });

//#endregion
//#region node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/builder.js
var Builder;
var init_builder = __esm({ "node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/builder.js": (() => {
	init_byte_buffer();
	init_constants();
	Builder = class Builder {
		/**
		* Create a FlatBufferBuilder.
		*/
		constructor(opt_initial_size) {
			/** Minimum alignment encountered so far. */
			this.minalign = 1;
			/** The vtable for the current table. */
			this.vtable = null;
			/** The amount of fields we're actually using. */
			this.vtable_in_use = 0;
			/** Whether we are currently serializing a table. */
			this.isNested = false;
			/** Starting offset of the current struct/table. */
			this.object_start = 0;
			/** List of offsets of all vtables. */
			this.vtables = [];
			/** For the current vector being built. */
			this.vector_num_elems = 0;
			/** False omits default values from the serialized data */
			this.force_defaults = false;
			this.string_maps = null;
			this.text_encoder = new TextEncoder();
			let initial_size;
			if (!opt_initial_size) initial_size = 1024;
			else initial_size = opt_initial_size;
			/**
			* @type {ByteBuffer}
			* @private
			*/
			this.bb = ByteBuffer.allocate(initial_size);
			this.space = initial_size;
		}
		clear() {
			this.bb.clear();
			this.space = this.bb.capacity();
			this.minalign = 1;
			this.vtable = null;
			this.vtable_in_use = 0;
			this.isNested = false;
			this.object_start = 0;
			this.vtables = [];
			this.vector_num_elems = 0;
			this.force_defaults = false;
			this.string_maps = null;
		}
		/**
		* In order to save space, fields that are set to their default value
		* don't get serialized into the buffer. Forcing defaults provides a
		* way to manually disable this optimization.
		*
		* @param forceDefaults true always serializes default values
		*/
		forceDefaults(forceDefaults) {
			this.force_defaults = forceDefaults;
		}
		/**
		* Get the ByteBuffer representing the FlatBuffer. Only call this after you've
		* called finish(). The actual data starts at the ByteBuffer's current position,
		* not necessarily at 0.
		*/
		dataBuffer() {
			return this.bb;
		}
		/**
		* Get the bytes representing the FlatBuffer. Only call this after you've
		* called finish().
		*/
		asUint8Array() {
			return this.bb.bytes().subarray(this.bb.position(), this.bb.position() + this.offset());
		}
		/**
		* Prepare to write an element of `size` after `additional_bytes` have been
		* written, e.g. if you write a string, you need to align such the int length
		* field is aligned to 4 bytes, and the string data follows it directly. If all
		* you need to do is alignment, `additional_bytes` will be 0.
		*
		* @param size This is the of the new element to write
		* @param additional_bytes The padding size
		*/
		prep(size, additional_bytes) {
			if (size > this.minalign) this.minalign = size;
			const align_size = ~(this.bb.capacity() - this.space + additional_bytes) + 1 & size - 1;
			while (this.space < align_size + size + additional_bytes) {
				const old_buf_size = this.bb.capacity();
				this.bb = Builder.growByteBuffer(this.bb);
				this.space += this.bb.capacity() - old_buf_size;
			}
			this.pad(align_size);
		}
		pad(byte_size) {
			for (let i = 0; i < byte_size; i++) this.bb.writeInt8(--this.space, 0);
		}
		writeInt8(value) {
			this.bb.writeInt8(this.space -= 1, value);
		}
		writeInt16(value) {
			this.bb.writeInt16(this.space -= 2, value);
		}
		writeInt32(value) {
			this.bb.writeInt32(this.space -= 4, value);
		}
		writeInt64(value) {
			this.bb.writeInt64(this.space -= 8, value);
		}
		writeFloat32(value) {
			this.bb.writeFloat32(this.space -= 4, value);
		}
		writeFloat64(value) {
			this.bb.writeFloat64(this.space -= 8, value);
		}
		/**
		* Add an `int8` to the buffer, properly aligned, and grows the buffer (if necessary).
		* @param value The `int8` to add the buffer.
		*/
		addInt8(value) {
			this.prep(1, 0);
			this.writeInt8(value);
		}
		/**
		* Add an `int16` to the buffer, properly aligned, and grows the buffer (if necessary).
		* @param value The `int16` to add the buffer.
		*/
		addInt16(value) {
			this.prep(2, 0);
			this.writeInt16(value);
		}
		/**
		* Add an `int32` to the buffer, properly aligned, and grows the buffer (if necessary).
		* @param value The `int32` to add the buffer.
		*/
		addInt32(value) {
			this.prep(4, 0);
			this.writeInt32(value);
		}
		/**
		* Add an `int64` to the buffer, properly aligned, and grows the buffer (if necessary).
		* @param value The `int64` to add the buffer.
		*/
		addInt64(value) {
			this.prep(8, 0);
			this.writeInt64(value);
		}
		/**
		* Add a `float32` to the buffer, properly aligned, and grows the buffer (if necessary).
		* @param value The `float32` to add the buffer.
		*/
		addFloat32(value) {
			this.prep(4, 0);
			this.writeFloat32(value);
		}
		/**
		* Add a `float64` to the buffer, properly aligned, and grows the buffer (if necessary).
		* @param value The `float64` to add the buffer.
		*/
		addFloat64(value) {
			this.prep(8, 0);
			this.writeFloat64(value);
		}
		addFieldInt8(voffset, value, defaultValue) {
			if (this.force_defaults || value != defaultValue) {
				this.addInt8(value);
				this.slot(voffset);
			}
		}
		addFieldInt16(voffset, value, defaultValue) {
			if (this.force_defaults || value != defaultValue) {
				this.addInt16(value);
				this.slot(voffset);
			}
		}
		addFieldInt32(voffset, value, defaultValue) {
			if (this.force_defaults || value != defaultValue) {
				this.addInt32(value);
				this.slot(voffset);
			}
		}
		addFieldInt64(voffset, value, defaultValue) {
			if (this.force_defaults || value !== defaultValue) {
				this.addInt64(value);
				this.slot(voffset);
			}
		}
		addFieldFloat32(voffset, value, defaultValue) {
			if (this.force_defaults || value != defaultValue) {
				this.addFloat32(value);
				this.slot(voffset);
			}
		}
		addFieldFloat64(voffset, value, defaultValue) {
			if (this.force_defaults || value != defaultValue) {
				this.addFloat64(value);
				this.slot(voffset);
			}
		}
		addFieldOffset(voffset, value, defaultValue) {
			if (this.force_defaults || value != defaultValue) {
				this.addOffset(value);
				this.slot(voffset);
			}
		}
		/**
		* Structs are stored inline, so nothing additional is being added. `d` is always 0.
		*/
		addFieldStruct(voffset, value, defaultValue) {
			if (value != defaultValue) {
				this.nested(value);
				this.slot(voffset);
			}
		}
		/**
		* Structures are always stored inline, they need to be created right
		* where they're used.  You'll get this assertion failure if you
		* created it elsewhere.
		*/
		nested(obj) {
			if (obj != this.offset()) throw new TypeError("FlatBuffers: struct must be serialized inline.");
		}
		/**
		* Should not be creating any other object, string or vector
		* while an object is being constructed
		*/
		notNested() {
			if (this.isNested) throw new TypeError("FlatBuffers: object serialization must not be nested.");
		}
		/**
		* Set the current vtable at `voffset` to the current location in the buffer.
		*/
		slot(voffset) {
			if (this.vtable !== null) this.vtable[voffset] = this.offset();
		}
		/**
		* @returns Offset relative to the end of the buffer.
		*/
		offset() {
			return this.bb.capacity() - this.space;
		}
		/**
		* Doubles the size of the backing ByteBuffer and copies the old data towards
		* the end of the new buffer (since we build the buffer backwards).
		*
		* @param bb The current buffer with the existing data
		* @returns A new byte buffer with the old data copied
		* to it. The data is located at the end of the buffer.
		*
		* uint8Array.set() formally takes {Array<number>|ArrayBufferView}, so to pass
		* it a uint8Array we need to suppress the type check:
		* @suppress {checkTypes}
		*/
		static growByteBuffer(bb) {
			const old_buf_size = bb.capacity();
			if (old_buf_size & 3221225472) throw new Error("FlatBuffers: cannot grow buffer beyond 2 gigabytes.");
			const new_buf_size = old_buf_size << 1;
			const nbb = ByteBuffer.allocate(new_buf_size);
			nbb.setPosition(new_buf_size - old_buf_size);
			nbb.bytes().set(bb.bytes(), new_buf_size - old_buf_size);
			return nbb;
		}
		/**
		* Adds on offset, relative to where it will be written.
		*
		* @param offset The offset to add.
		*/
		addOffset(offset) {
			this.prep(SIZEOF_INT, 0);
			this.writeInt32(this.offset() - offset + SIZEOF_INT);
		}
		/**
		* Start encoding a new object in the buffer.  Users will not usually need to
		* call this directly. The FlatBuffers compiler will generate helper methods
		* that call this method internally.
		*/
		startObject(numfields) {
			this.notNested();
			if (this.vtable == null) this.vtable = [];
			this.vtable_in_use = numfields;
			for (let i = 0; i < numfields; i++) this.vtable[i] = 0;
			this.isNested = true;
			this.object_start = this.offset();
		}
		/**
		* Finish off writing the object that is under construction.
		*
		* @returns The offset to the object inside `dataBuffer`
		*/
		endObject() {
			if (this.vtable == null || !this.isNested) throw new Error("FlatBuffers: endObject called without startObject");
			this.addInt32(0);
			const vtableloc = this.offset();
			let i = this.vtable_in_use - 1;
			for (; i >= 0 && this.vtable[i] == 0; i--);
			const trimmed_size = i + 1;
			for (; i >= 0; i--) this.addInt16(this.vtable[i] != 0 ? vtableloc - this.vtable[i] : 0);
			const standard_fields = 2;
			this.addInt16(vtableloc - this.object_start);
			const len = (trimmed_size + standard_fields) * SIZEOF_SHORT;
			this.addInt16(len);
			let existing_vtable = 0;
			const vt1 = this.space;
			outer_loop: for (i = 0; i < this.vtables.length; i++) {
				const vt2 = this.bb.capacity() - this.vtables[i];
				if (len == this.bb.readInt16(vt2)) {
					for (let j = SIZEOF_SHORT; j < len; j += SIZEOF_SHORT) if (this.bb.readInt16(vt1 + j) != this.bb.readInt16(vt2 + j)) continue outer_loop;
					existing_vtable = this.vtables[i];
					break;
				}
			}
			if (existing_vtable) {
				this.space = this.bb.capacity() - vtableloc;
				this.bb.writeInt32(this.space, existing_vtable - vtableloc);
			} else {
				this.vtables.push(this.offset());
				this.bb.writeInt32(this.bb.capacity() - vtableloc, this.offset() - vtableloc);
			}
			this.isNested = false;
			return vtableloc;
		}
		/**
		* Finalize a buffer, poiting to the given `root_table`.
		*/
		finish(root_table, opt_file_identifier, opt_size_prefix) {
			const size_prefix = opt_size_prefix ? SIZE_PREFIX_LENGTH : 0;
			if (opt_file_identifier) {
				const file_identifier = opt_file_identifier;
				this.prep(this.minalign, SIZEOF_INT + FILE_IDENTIFIER_LENGTH + size_prefix);
				if (file_identifier.length != FILE_IDENTIFIER_LENGTH) throw new TypeError("FlatBuffers: file identifier must be length " + FILE_IDENTIFIER_LENGTH);
				for (let i = FILE_IDENTIFIER_LENGTH - 1; i >= 0; i--) this.writeInt8(file_identifier.charCodeAt(i));
			}
			this.prep(this.minalign, SIZEOF_INT + size_prefix);
			this.addOffset(root_table);
			if (size_prefix) this.addInt32(this.bb.capacity() - this.space);
			this.bb.setPosition(this.space);
		}
		/**
		* Finalize a size prefixed buffer, pointing to the given `root_table`.
		*/
		finishSizePrefixed(root_table, opt_file_identifier) {
			this.finish(root_table, opt_file_identifier, true);
		}
		/**
		* This checks a required field has been set in a given table that has
		* just been constructed.
		*/
		requiredField(table, field) {
			const table_start = this.bb.capacity() - table;
			const vtable_start = table_start - this.bb.readInt32(table_start);
			if (!(field < this.bb.readInt16(vtable_start) && this.bb.readInt16(vtable_start + field) != 0)) throw new TypeError("FlatBuffers: field " + field + " must be set");
		}
		/**
		* Start a new array/vector of objects.  Users usually will not call
		* this directly. The FlatBuffers compiler will create a start/end
		* method for vector types in generated code.
		*
		* @param elem_size The size of each element in the array
		* @param num_elems The number of elements in the array
		* @param alignment The alignment of the array
		*/
		startVector(elem_size, num_elems, alignment) {
			this.notNested();
			this.vector_num_elems = num_elems;
			this.prep(SIZEOF_INT, elem_size * num_elems);
			this.prep(alignment, elem_size * num_elems);
		}
		/**
		* Finish off the creation of an array and all its elements. The array must be
		* created with `startVector`.
		*
		* @returns The offset at which the newly created array
		* starts.
		*/
		endVector() {
			this.writeInt32(this.vector_num_elems);
			return this.offset();
		}
		/**
		* Encode the string `s` in the buffer using UTF-8. If the string passed has
		* already been seen, we return the offset of the already written string
		*
		* @param s The string to encode
		* @return The offset in the buffer where the encoded string starts
		*/
		createSharedString(s) {
			if (!s) return 0;
			if (!this.string_maps) this.string_maps = /* @__PURE__ */ new Map();
			if (this.string_maps.has(s)) return this.string_maps.get(s);
			const offset = this.createString(s);
			this.string_maps.set(s, offset);
			return offset;
		}
		/**
		* Encode the string `s` in the buffer using UTF-8. If a Uint8Array is passed
		* instead of a string, it is assumed to contain valid UTF-8 encoded data.
		*
		* @param s The string to encode
		* @return The offset in the buffer where the encoded string starts
		*/
		createString(s) {
			if (s === null || s === void 0) return 0;
			let utf8;
			if (s instanceof Uint8Array) utf8 = s;
			else utf8 = this.text_encoder.encode(s);
			this.addInt8(0);
			this.startVector(1, utf8.length, 1);
			this.bb.setPosition(this.space -= utf8.length);
			this.bb.bytes().set(utf8, this.space);
			return this.endVector();
		}
		/**
		* Create a byte vector.
		*
		* @param v The bytes to add
		* @returns The offset in the buffer where the byte vector starts
		*/
		createByteVector(v) {
			if (v === null || v === void 0) return 0;
			this.startVector(1, v.length, 1);
			this.bb.setPosition(this.space -= v.length);
			this.bb.bytes().set(v, this.space);
			return this.endVector();
		}
		/**
		* A helper function to pack an object
		*
		* @returns offset of obj
		*/
		createObjectOffset(obj) {
			if (obj === null) return 0;
			if (typeof obj === "string") return this.createString(obj);
			else return obj.pack(this);
		}
		/**
		* A helper function to pack a list of object
		*
		* @returns list of offsets of each non null object
		*/
		createObjectOffsetList(list) {
			const ret = [];
			for (let i = 0; i < list.length; ++i) {
				const val = list[i];
				if (val !== null) ret.push(this.createObjectOffset(val));
				else throw new TypeError("FlatBuffers: Argument for createObjectOffsetList cannot contain null.");
			}
			return ret;
		}
		createStructOffsetList(list, startFunc) {
			startFunc(this, list.length);
			this.createObjectOffsetList(list.slice().reverse());
			return this.endVector();
		}
	};
}) });

//#endregion
//#region node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/flatbuffers.js
var flatbuffers_exports = /* @__PURE__ */ __export({
	Builder: () => Builder,
	ByteBuffer: () => ByteBuffer,
	Encoding: () => Encoding,
	FILE_IDENTIFIER_LENGTH: () => FILE_IDENTIFIER_LENGTH,
	SIZEOF_INT: () => SIZEOF_INT,
	SIZEOF_SHORT: () => SIZEOF_SHORT,
	SIZE_PREFIX_LENGTH: () => SIZE_PREFIX_LENGTH,
	float32: () => float32,
	float64: () => float64,
	int32: () => int32,
	isLittleEndian: () => isLittleEndian
});
var init_flatbuffers = __esm({ "node_modules/.pnpm/flatbuffers@25.9.23/node_modules/flatbuffers/mjs/flatbuffers.js": (() => {
	init_constants();
	init_utils();
	init_builder();
	init_byte_buffer();
	init_encoding();
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/model.js
var require_model = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/model.js": ((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Model = void 0;
	var Model;
	(function(Model$1) {
		Model$1[Model$1["undefined"] = 0] = "undefined";
		Model$1[Model$1["best_match"] = 1] = "best_match";
		Model$1[Model$1["gfs_seamless"] = 2] = "gfs_seamless";
		Model$1[Model$1["gfs_global"] = 3] = "gfs_global";
		Model$1[Model$1["gfs_hrrr"] = 4] = "gfs_hrrr";
		Model$1[Model$1["meteofrance_seamless"] = 5] = "meteofrance_seamless";
		Model$1[Model$1["meteofrance_arpege_seamless"] = 6] = "meteofrance_arpege_seamless";
		Model$1[Model$1["meteofrance_arpege_world"] = 7] = "meteofrance_arpege_world";
		Model$1[Model$1["meteofrance_arpege_europe"] = 8] = "meteofrance_arpege_europe";
		Model$1[Model$1["meteofrance_arome_seamless"] = 9] = "meteofrance_arome_seamless";
		Model$1[Model$1["meteofrance_arome_france"] = 10] = "meteofrance_arome_france";
		Model$1[Model$1["meteofrance_arome_france_hd"] = 11] = "meteofrance_arome_france_hd";
		Model$1[Model$1["jma_seamless"] = 12] = "jma_seamless";
		Model$1[Model$1["jma_msm"] = 13] = "jma_msm";
		Model$1[Model$1["jms_gsm"] = 14] = "jms_gsm";
		Model$1[Model$1["jma_gsm"] = 15] = "jma_gsm";
		Model$1[Model$1["gem_seamless"] = 16] = "gem_seamless";
		Model$1[Model$1["gem_global"] = 17] = "gem_global";
		Model$1[Model$1["gem_regional"] = 18] = "gem_regional";
		Model$1[Model$1["gem_hrdps_continental"] = 19] = "gem_hrdps_continental";
		Model$1[Model$1["icon_seamless"] = 20] = "icon_seamless";
		Model$1[Model$1["icon_global"] = 21] = "icon_global";
		Model$1[Model$1["icon_eu"] = 22] = "icon_eu";
		Model$1[Model$1["icon_d2"] = 23] = "icon_d2";
		Model$1[Model$1["ecmwf_ifs04"] = 24] = "ecmwf_ifs04";
		Model$1[Model$1["metno_nordic"] = 25] = "metno_nordic";
		Model$1[Model$1["era5_seamless"] = 26] = "era5_seamless";
		Model$1[Model$1["era5"] = 27] = "era5";
		Model$1[Model$1["cerra"] = 28] = "cerra";
		Model$1[Model$1["era5_land"] = 29] = "era5_land";
		Model$1[Model$1["ecmwf_ifs"] = 30] = "ecmwf_ifs";
		Model$1[Model$1["gwam"] = 31] = "gwam";
		Model$1[Model$1["ewam"] = 32] = "ewam";
		Model$1[Model$1["glofas_seamless_v3"] = 33] = "glofas_seamless_v3";
		Model$1[Model$1["glofas_forecast_v3"] = 34] = "glofas_forecast_v3";
		Model$1[Model$1["glofas_consolidated_v3"] = 35] = "glofas_consolidated_v3";
		Model$1[Model$1["glofas_seamless_v4"] = 36] = "glofas_seamless_v4";
		Model$1[Model$1["glofas_forecast_v4"] = 37] = "glofas_forecast_v4";
		Model$1[Model$1["glofas_consolidated_v4"] = 38] = "glofas_consolidated_v4";
		Model$1[Model$1["gfs025"] = 39] = "gfs025";
		Model$1[Model$1["gfs05"] = 40] = "gfs05";
		Model$1[Model$1["CMCC_CM2_VHR4"] = 41] = "CMCC_CM2_VHR4";
		Model$1[Model$1["FGOALS_f3_H_highresSST"] = 42] = "FGOALS_f3_H_highresSST";
		Model$1[Model$1["FGOALS_f3_H"] = 43] = "FGOALS_f3_H";
		Model$1[Model$1["HiRAM_SIT_HR"] = 44] = "HiRAM_SIT_HR";
		Model$1[Model$1["MRI_AGCM3_2_S"] = 45] = "MRI_AGCM3_2_S";
		Model$1[Model$1["EC_Earth3P_HR"] = 46] = "EC_Earth3P_HR";
		Model$1[Model$1["MPI_ESM1_2_XR"] = 47] = "MPI_ESM1_2_XR";
		Model$1[Model$1["NICAM16_8S"] = 48] = "NICAM16_8S";
		Model$1[Model$1["cams_europe"] = 49] = "cams_europe";
		Model$1[Model$1["cams_global"] = 50] = "cams_global";
		Model$1[Model$1["cfsv2"] = 51] = "cfsv2";
		Model$1[Model$1["era5_ocean"] = 52] = "era5_ocean";
		Model$1[Model$1["cma_grapes_global"] = 53] = "cma_grapes_global";
		Model$1[Model$1["bom_access_global"] = 54] = "bom_access_global";
		Model$1[Model$1["bom_access_global_ensemble"] = 55] = "bom_access_global_ensemble";
		Model$1[Model$1["arpae_cosmo_seamless"] = 56] = "arpae_cosmo_seamless";
		Model$1[Model$1["arpae_cosmo_2i"] = 57] = "arpae_cosmo_2i";
		Model$1[Model$1["arpae_cosmo_2i_ruc"] = 58] = "arpae_cosmo_2i_ruc";
		Model$1[Model$1["arpae_cosmo_5m"] = 59] = "arpae_cosmo_5m";
		Model$1[Model$1["ecmwf_ifs025"] = 60] = "ecmwf_ifs025";
		Model$1[Model$1["ecmwf_aifs025"] = 61] = "ecmwf_aifs025";
		Model$1[Model$1["gfs013"] = 62] = "gfs013";
		Model$1[Model$1["gfs_graphcast025"] = 63] = "gfs_graphcast025";
		Model$1[Model$1["ecmwf_wam025"] = 64] = "ecmwf_wam025";
		Model$1[Model$1["meteofrance_wave"] = 65] = "meteofrance_wave";
		Model$1[Model$1["meteofrance_currents"] = 66] = "meteofrance_currents";
		Model$1[Model$1["ecmwf_wam025_ensemble"] = 67] = "ecmwf_wam025_ensemble";
		Model$1[Model$1["ncep_gfswave025"] = 68] = "ncep_gfswave025";
		Model$1[Model$1["ncep_gefswave025"] = 69] = "ncep_gefswave025";
		Model$1[Model$1["knmi_seamless"] = 70] = "knmi_seamless";
		Model$1[Model$1["knmi_harmonie_arome_europe"] = 71] = "knmi_harmonie_arome_europe";
		Model$1[Model$1["knmi_harmonie_arome_netherlands"] = 72] = "knmi_harmonie_arome_netherlands";
		Model$1[Model$1["dmi_seamless"] = 73] = "dmi_seamless";
		Model$1[Model$1["dmi_harmonie_arome_europe"] = 74] = "dmi_harmonie_arome_europe";
		Model$1[Model$1["metno_seamless"] = 75] = "metno_seamless";
		Model$1[Model$1["era5_ensemble"] = 76] = "era5_ensemble";
		Model$1[Model$1["ecmwf_ifs_analysis"] = 77] = "ecmwf_ifs_analysis";
		Model$1[Model$1["ecmwf_ifs_long_window"] = 78] = "ecmwf_ifs_long_window";
		Model$1[Model$1["ecmwf_ifs_analysis_long_window"] = 79] = "ecmwf_ifs_analysis_long_window";
		Model$1[Model$1["ukmo_global_deterministic_10km"] = 80] = "ukmo_global_deterministic_10km";
		Model$1[Model$1["ukmo_uk_deterministic_2km"] = 81] = "ukmo_uk_deterministic_2km";
		Model$1[Model$1["ukmo_seamless"] = 82] = "ukmo_seamless";
		Model$1[Model$1["ncep_gfswave016"] = 83] = "ncep_gfswave016";
		Model$1[Model$1["ncep_nbm_conus"] = 84] = "ncep_nbm_conus";
		Model$1[Model$1["ukmo_global_ensemble_20km"] = 85] = "ukmo_global_ensemble_20km";
		Model$1[Model$1["ecmwf_aifs025_single"] = 86] = "ecmwf_aifs025_single";
		Model$1[Model$1["jma_jaxa_himawari"] = 87] = "jma_jaxa_himawari";
		Model$1[Model$1["eumetsat_sarah3"] = 88] = "eumetsat_sarah3";
		Model$1[Model$1["eumetsat_lsa_saf_msg"] = 89] = "eumetsat_lsa_saf_msg";
		Model$1[Model$1["eumetsat_lsa_saf_iodc"] = 90] = "eumetsat_lsa_saf_iodc";
		Model$1[Model$1["satellite_radiation_seamless"] = 91] = "satellite_radiation_seamless";
		Model$1[Model$1["kma_gdps"] = 92] = "kma_gdps";
		Model$1[Model$1["kma_ldps"] = 93] = "kma_ldps";
		Model$1[Model$1["kma_seamless"] = 94] = "kma_seamless";
		Model$1[Model$1["italia_meteo_arpae_icon_2i"] = 95] = "italia_meteo_arpae_icon_2i";
		Model$1[Model$1["ukmo_uk_ensemble_2km"] = 96] = "ukmo_uk_ensemble_2km";
		Model$1[Model$1["meteofrance_arome_france_hd_15min"] = 97] = "meteofrance_arome_france_hd_15min";
		Model$1[Model$1["meteofrance_arome_france_15min"] = 98] = "meteofrance_arome_france_15min";
		Model$1[Model$1["meteoswiss_icon_ch1"] = 99] = "meteoswiss_icon_ch1";
		Model$1[Model$1["meteoswiss_icon_ch2"] = 100] = "meteoswiss_icon_ch2";
		Model$1[Model$1["meteoswiss_icon_ch1_ensemble"] = 101] = "meteoswiss_icon_ch1_ensemble";
		Model$1[Model$1["meteoswiss_icon_ch2_ensemble"] = 102] = "meteoswiss_icon_ch2_ensemble";
		Model$1[Model$1["meteoswiss_icon_seamless"] = 103] = "meteoswiss_icon_seamless";
		Model$1[Model$1["ncep_nam_conus"] = 104] = "ncep_nam_conus";
		Model$1[Model$1["icon_d2_ruc"] = 105] = "icon_d2_ruc";
		Model$1[Model$1["ecmwf_seas5"] = 106] = "ecmwf_seas5";
		Model$1[Model$1["ecmwf_ec46"] = 107] = "ecmwf_ec46";
		Model$1[Model$1["ecmwf_seasonal_seamless"] = 108] = "ecmwf_seasonal_seamless";
		Model$1[Model$1["ecmwf_ifs_seamless"] = 109] = "ecmwf_ifs_seamless";
		Model$1[Model$1["jma_jaxa_mtg_fci"] = 110] = "jma_jaxa_mtg_fci";
		Model$1[Model$1["gem_hrdps_west"] = 111] = "gem_hrdps_west";
		Model$1[Model$1["ecmwf_wam"] = 112] = "ecmwf_wam";
		Model$1[Model$1["ncep_aigfs025"] = 113] = "ncep_aigfs025";
		Model$1[Model$1["ncep_aigefs025"] = 114] = "ncep_aigefs025";
		Model$1[Model$1["ncep_hgefs025_ensemble_mean"] = 115] = "ncep_hgefs025_ensemble_mean";
		Model$1[Model$1["ecmwf_seasonal_ensemble_mean_seamless"] = 116] = "ecmwf_seasonal_ensemble_mean_seamless";
		Model$1[Model$1["ecmwf_seas5_ensemble_mean"] = 117] = "ecmwf_seas5_ensemble_mean";
		Model$1[Model$1["ecmwf_ec46_ensemble_mean"] = 118] = "ecmwf_ec46_ensemble_mean";
		Model$1[Model$1["ncep_aigefs025_ensemble_mean"] = 119] = "ncep_aigefs025_ensemble_mean";
		Model$1[Model$1["dwd_icon_eps_ensemble_mean_seamless"] = 120] = "dwd_icon_eps_ensemble_mean_seamless";
		Model$1[Model$1["dwd_icon_eps_ensemble_mean"] = 121] = "dwd_icon_eps_ensemble_mean";
		Model$1[Model$1["dwd_icon_eu_eps_ensemble_mean"] = 122] = "dwd_icon_eu_eps_ensemble_mean";
		Model$1[Model$1["dwd_icon_d2_eps_ensemble_mean"] = 123] = "dwd_icon_d2_eps_ensemble_mean";
		Model$1[Model$1["ncep_gefs_ensemble_mean_seamless"] = 124] = "ncep_gefs_ensemble_mean_seamless";
		Model$1[Model$1["ncep_gefs025_ensemble_mean"] = 125] = "ncep_gefs025_ensemble_mean";
		Model$1[Model$1["ncep_gefs05_ensemble_mean"] = 126] = "ncep_gefs05_ensemble_mean";
		Model$1[Model$1["ecmwf_ifs025_ensemble_mean"] = 127] = "ecmwf_ifs025_ensemble_mean";
		Model$1[Model$1["ecmwf_aifs025_ensemble_mean"] = 128] = "ecmwf_aifs025_ensemble_mean";
		Model$1[Model$1["meteoswiss_icon_ch1_ensemble_mean"] = 129] = "meteoswiss_icon_ch1_ensemble_mean";
		Model$1[Model$1["meteoswiss_icon_ch2_ensemble_mean"] = 130] = "meteoswiss_icon_ch2_ensemble_mean";
		Model$1[Model$1["cmc_gem_geps_ensemble_mean"] = 131] = "cmc_gem_geps_ensemble_mean";
		Model$1[Model$1["ukmo_global_ensemble_mean_20km"] = 132] = "ukmo_global_ensemble_mean_20km";
		Model$1[Model$1["ukmo_uk_ensemble_mean_2km"] = 133] = "ukmo_uk_ensemble_mean_2km";
	})(Model || (exports.Model = Model = {}));
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/aggregation.js
var require_aggregation = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/aggregation.js": ((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Aggregation = void 0;
	var Aggregation;
	(function(Aggregation$1) {
		Aggregation$1[Aggregation$1["none"] = 0] = "none";
		Aggregation$1[Aggregation$1["minimum"] = 1] = "minimum";
		Aggregation$1[Aggregation$1["maximum"] = 2] = "maximum";
		Aggregation$1[Aggregation$1["mean"] = 3] = "mean";
		Aggregation$1[Aggregation$1["p10"] = 4] = "p10";
		Aggregation$1[Aggregation$1["p25"] = 5] = "p25";
		Aggregation$1[Aggregation$1["median"] = 6] = "median";
		Aggregation$1[Aggregation$1["p75"] = 7] = "p75";
		Aggregation$1[Aggregation$1["p90"] = 8] = "p90";
		Aggregation$1[Aggregation$1["dominant"] = 9] = "dominant";
		Aggregation$1[Aggregation$1["sum"] = 10] = "sum";
		Aggregation$1[Aggregation$1["spread"] = 11] = "spread";
		Aggregation$1[Aggregation$1["anomaly"] = 12] = "anomaly";
		Aggregation$1[Aggregation$1["sot10"] = 13] = "sot10";
		Aggregation$1[Aggregation$1["sot90"] = 14] = "sot90";
		Aggregation$1[Aggregation$1["efi"] = 15] = "efi";
	})(Aggregation || (exports.Aggregation = Aggregation = {}));
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/probability.js
var require_probability = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/probability.js": ((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Probability = void 0;
	var Probability;
	(function(Probability$1) {
		Probability$1[Probability$1["none"] = 0] = "none";
		Probability$1[Probability$1["gt0"] = 1] = "gt0";
		Probability$1[Probability$1["gt0p1"] = 2] = "gt0p1";
		Probability$1[Probability$1["gt1"] = 3] = "gt1";
		Probability$1[Probability$1["gt2"] = 4] = "gt2";
		Probability$1[Probability$1["gt3"] = 5] = "gt3";
		Probability$1[Probability$1["gt4"] = 6] = "gt4";
		Probability$1[Probability$1["gt5"] = 7] = "gt5";
		Probability$1[Probability$1["gt8"] = 8] = "gt8";
		Probability$1[Probability$1["gt10"] = 9] = "gt10";
		Probability$1[Probability$1["gt15"] = 10] = "gt15";
		Probability$1[Probability$1["gt20"] = 11] = "gt20";
		Probability$1[Probability$1["gt25"] = 12] = "gt25";
		Probability$1[Probability$1["gt30"] = 13] = "gt30";
		Probability$1[Probability$1["gt35"] = 14] = "gt35";
		Probability$1[Probability$1["gt40"] = 15] = "gt40";
		Probability$1[Probability$1["gt50"] = 16] = "gt50";
		Probability$1[Probability$1["gt60"] = 17] = "gt60";
		Probability$1[Probability$1["gt75"] = 18] = "gt75";
		Probability$1[Probability$1["gt80"] = 19] = "gt80";
		Probability$1[Probability$1["gt100"] = 20] = "gt100";
		Probability$1[Probability$1["lt0"] = 21] = "lt0";
		Probability$1[Probability$1["lt0p1"] = 22] = "lt0p1";
		Probability$1[Probability$1["lt1"] = 23] = "lt1";
		Probability$1[Probability$1["ltm1"] = 24] = "ltm1";
		Probability$1[Probability$1["ltm2"] = 25] = "ltm2";
		Probability$1[Probability$1["ltm3"] = 26] = "ltm3";
		Probability$1[Probability$1["ltm4"] = 27] = "ltm4";
		Probability$1[Probability$1["ltm5"] = 28] = "ltm5";
		Probability$1[Probability$1["ltm8"] = 29] = "ltm8";
		Probability$1[Probability$1["ltm10"] = 30] = "ltm10";
		Probability$1[Probability$1["ltm15"] = 31] = "ltm15";
		Probability$1[Probability$1["ltm20"] = 32] = "ltm20";
		Probability$1[Probability$1["gt1stdev"] = 33] = "gt1stdev";
		Probability$1[Probability$1["gt1p5stdev"] = 34] = "gt1p5stdev";
		Probability$1[Probability$1["gt2stdev"] = 35] = "gt2stdev";
		Probability$1[Probability$1["lt1stdev"] = 36] = "lt1stdev";
		Probability$1[Probability$1["lt1p5stdev"] = 37] = "lt1p5stdev";
		Probability$1[Probability$1["lt2stdev"] = 38] = "lt2stdev";
	})(Probability || (exports.Probability = Probability = {}));
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/unit.js
var require_unit = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/unit.js": ((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Unit = void 0;
	var Unit;
	(function(Unit$1) {
		Unit$1[Unit$1["undefined"] = 0] = "undefined";
		Unit$1[Unit$1["celsius"] = 1] = "celsius";
		Unit$1[Unit$1["centimetre"] = 2] = "centimetre";
		Unit$1[Unit$1["cubic_metre_per_cubic_metre"] = 3] = "cubic_metre_per_cubic_metre";
		Unit$1[Unit$1["cubic_metre_per_second"] = 4] = "cubic_metre_per_second";
		Unit$1[Unit$1["degree_direction"] = 5] = "degree_direction";
		Unit$1[Unit$1["dimensionless_integer"] = 6] = "dimensionless_integer";
		Unit$1[Unit$1["dimensionless"] = 7] = "dimensionless";
		Unit$1[Unit$1["european_air_quality_index"] = 8] = "european_air_quality_index";
		Unit$1[Unit$1["fahrenheit"] = 9] = "fahrenheit";
		Unit$1[Unit$1["feet"] = 10] = "feet";
		Unit$1[Unit$1["fraction"] = 11] = "fraction";
		Unit$1[Unit$1["gdd_celsius"] = 12] = "gdd_celsius";
		Unit$1[Unit$1["geopotential_metre"] = 13] = "geopotential_metre";
		Unit$1[Unit$1["grains_per_cubic_metre"] = 14] = "grains_per_cubic_metre";
		Unit$1[Unit$1["gram_per_kilogram"] = 15] = "gram_per_kilogram";
		Unit$1[Unit$1["hectopascal"] = 16] = "hectopascal";
		Unit$1[Unit$1["hours"] = 17] = "hours";
		Unit$1[Unit$1["inch"] = 18] = "inch";
		Unit$1[Unit$1["iso8601"] = 19] = "iso8601";
		Unit$1[Unit$1["joule_per_kilogram"] = 20] = "joule_per_kilogram";
		Unit$1[Unit$1["kelvin"] = 21] = "kelvin";
		Unit$1[Unit$1["kilopascal"] = 22] = "kilopascal";
		Unit$1[Unit$1["kilogram_per_square_metre"] = 23] = "kilogram_per_square_metre";
		Unit$1[Unit$1["kilometres_per_hour"] = 24] = "kilometres_per_hour";
		Unit$1[Unit$1["knots"] = 25] = "knots";
		Unit$1[Unit$1["megajoule_per_square_metre"] = 26] = "megajoule_per_square_metre";
		Unit$1[Unit$1["metre_per_second_not_unit_converted"] = 27] = "metre_per_second_not_unit_converted";
		Unit$1[Unit$1["metre_per_second"] = 28] = "metre_per_second";
		Unit$1[Unit$1["metre"] = 29] = "metre";
		Unit$1[Unit$1["micrograms_per_cubic_metre"] = 30] = "micrograms_per_cubic_metre";
		Unit$1[Unit$1["miles_per_hour"] = 31] = "miles_per_hour";
		Unit$1[Unit$1["millimetre"] = 32] = "millimetre";
		Unit$1[Unit$1["pascal"] = 33] = "pascal";
		Unit$1[Unit$1["per_second"] = 34] = "per_second";
		Unit$1[Unit$1["percentage"] = 35] = "percentage";
		Unit$1[Unit$1["seconds"] = 36] = "seconds";
		Unit$1[Unit$1["unix_time"] = 37] = "unix_time";
		Unit$1[Unit$1["us_air_quality_index"] = 38] = "us_air_quality_index";
		Unit$1[Unit$1["watt_per_square_metre"] = 39] = "watt_per_square_metre";
		Unit$1[Unit$1["wmo_code"] = 40] = "wmo_code";
		Unit$1[Unit$1["parts_per_million"] = 41] = "parts_per_million";
		Unit$1[Unit$1["kilogram_per_cubic_metre"] = 42] = "kilogram_per_cubic_metre";
	})(Unit || (exports.Unit = Unit = {}));
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/variable.js
var require_variable = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/variable.js": ((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.Variable = void 0;
	var Variable;
	(function(Variable$1) {
		Variable$1[Variable$1["undefined"] = 0] = "undefined";
		Variable$1[Variable$1["apparent_temperature"] = 1] = "apparent_temperature";
		Variable$1[Variable$1["cape"] = 2] = "cape";
		Variable$1[Variable$1["cloud_cover"] = 3] = "cloud_cover";
		Variable$1[Variable$1["cloud_cover_high"] = 4] = "cloud_cover_high";
		Variable$1[Variable$1["cloud_cover_low"] = 5] = "cloud_cover_low";
		Variable$1[Variable$1["cloud_cover_mid"] = 6] = "cloud_cover_mid";
		Variable$1[Variable$1["daylight_duration"] = 7] = "daylight_duration";
		Variable$1[Variable$1["dew_point"] = 8] = "dew_point";
		Variable$1[Variable$1["diffuse_radiation"] = 9] = "diffuse_radiation";
		Variable$1[Variable$1["diffuse_radiation_instant"] = 10] = "diffuse_radiation_instant";
		Variable$1[Variable$1["direct_normal_irradiance"] = 11] = "direct_normal_irradiance";
		Variable$1[Variable$1["direct_normal_irradiance_instant"] = 12] = "direct_normal_irradiance_instant";
		Variable$1[Variable$1["direct_radiation"] = 13] = "direct_radiation";
		Variable$1[Variable$1["direct_radiation_instant"] = 14] = "direct_radiation_instant";
		Variable$1[Variable$1["et0_fao_evapotranspiration"] = 15] = "et0_fao_evapotranspiration";
		Variable$1[Variable$1["evapotranspiration"] = 16] = "evapotranspiration";
		Variable$1[Variable$1["freezing_level_height"] = 17] = "freezing_level_height";
		Variable$1[Variable$1["growing_degree_days"] = 18] = "growing_degree_days";
		Variable$1[Variable$1["is_day"] = 19] = "is_day";
		Variable$1[Variable$1["latent_heat_flux"] = 20] = "latent_heat_flux";
		Variable$1[Variable$1["leaf_wetness_probability"] = 21] = "leaf_wetness_probability";
		Variable$1[Variable$1["lifted_index"] = 22] = "lifted_index";
		Variable$1[Variable$1["lightning_potential"] = 23] = "lightning_potential";
		Variable$1[Variable$1["precipitation"] = 24] = "precipitation";
		Variable$1[Variable$1["precipitation_hours"] = 25] = "precipitation_hours";
		Variable$1[Variable$1["precipitation_probability"] = 26] = "precipitation_probability";
		Variable$1[Variable$1["pressure_msl"] = 27] = "pressure_msl";
		Variable$1[Variable$1["rain"] = 28] = "rain";
		Variable$1[Variable$1["relative_humidity"] = 29] = "relative_humidity";
		Variable$1[Variable$1["runoff"] = 30] = "runoff";
		Variable$1[Variable$1["sensible_heat_flux"] = 31] = "sensible_heat_flux";
		Variable$1[Variable$1["shortwave_radiation"] = 32] = "shortwave_radiation";
		Variable$1[Variable$1["shortwave_radiation_instant"] = 33] = "shortwave_radiation_instant";
		Variable$1[Variable$1["showers"] = 34] = "showers";
		Variable$1[Variable$1["snow_depth"] = 35] = "snow_depth";
		Variable$1[Variable$1["snow_height"] = 36] = "snow_height";
		Variable$1[Variable$1["snowfall"] = 37] = "snowfall";
		Variable$1[Variable$1["snowfall_height"] = 38] = "snowfall_height";
		Variable$1[Variable$1["snowfall_water_equivalent"] = 39] = "snowfall_water_equivalent";
		Variable$1[Variable$1["sunrise"] = 40] = "sunrise";
		Variable$1[Variable$1["sunset"] = 41] = "sunset";
		Variable$1[Variable$1["soil_moisture"] = 42] = "soil_moisture";
		Variable$1[Variable$1["soil_moisture_index"] = 43] = "soil_moisture_index";
		Variable$1[Variable$1["soil_temperature"] = 44] = "soil_temperature";
		Variable$1[Variable$1["surface_pressure"] = 45] = "surface_pressure";
		Variable$1[Variable$1["surface_temperature"] = 46] = "surface_temperature";
		Variable$1[Variable$1["temperature"] = 47] = "temperature";
		Variable$1[Variable$1["terrestrial_radiation"] = 48] = "terrestrial_radiation";
		Variable$1[Variable$1["terrestrial_radiation_instant"] = 49] = "terrestrial_radiation_instant";
		Variable$1[Variable$1["total_column_integrated_water_vapour"] = 50] = "total_column_integrated_water_vapour";
		Variable$1[Variable$1["updraft"] = 51] = "updraft";
		Variable$1[Variable$1["uv_index"] = 52] = "uv_index";
		Variable$1[Variable$1["uv_index_clear_sky"] = 53] = "uv_index_clear_sky";
		Variable$1[Variable$1["vapour_pressure_deficit"] = 54] = "vapour_pressure_deficit";
		Variable$1[Variable$1["visibility"] = 55] = "visibility";
		Variable$1[Variable$1["weather_code"] = 56] = "weather_code";
		Variable$1[Variable$1["wind_direction"] = 57] = "wind_direction";
		Variable$1[Variable$1["wind_gusts"] = 58] = "wind_gusts";
		Variable$1[Variable$1["wind_speed"] = 59] = "wind_speed";
		Variable$1[Variable$1["vertical_velocity"] = 60] = "vertical_velocity";
		Variable$1[Variable$1["geopotential_height"] = 61] = "geopotential_height";
		Variable$1[Variable$1["wet_bulb_temperature"] = 62] = "wet_bulb_temperature";
		Variable$1[Variable$1["river_discharge"] = 63] = "river_discharge";
		Variable$1[Variable$1["wave_height"] = 64] = "wave_height";
		Variable$1[Variable$1["wave_period"] = 65] = "wave_period";
		Variable$1[Variable$1["wave_direction"] = 66] = "wave_direction";
		Variable$1[Variable$1["wind_wave_height"] = 67] = "wind_wave_height";
		Variable$1[Variable$1["wind_wave_period"] = 68] = "wind_wave_period";
		Variable$1[Variable$1["wind_wave_peak_period"] = 69] = "wind_wave_peak_period";
		Variable$1[Variable$1["wind_wave_direction"] = 70] = "wind_wave_direction";
		Variable$1[Variable$1["swell_wave_height"] = 71] = "swell_wave_height";
		Variable$1[Variable$1["swell_wave_period"] = 72] = "swell_wave_period";
		Variable$1[Variable$1["swell_wave_peak_period"] = 73] = "swell_wave_peak_period";
		Variable$1[Variable$1["swell_wave_direction"] = 74] = "swell_wave_direction";
		Variable$1[Variable$1["pm10"] = 75] = "pm10";
		Variable$1[Variable$1["pm2p5"] = 76] = "pm2p5";
		Variable$1[Variable$1["dust"] = 77] = "dust";
		Variable$1[Variable$1["aerosol_optical_depth"] = 78] = "aerosol_optical_depth";
		Variable$1[Variable$1["carbon_monoxide"] = 79] = "carbon_monoxide";
		Variable$1[Variable$1["nitrogen_dioxide"] = 80] = "nitrogen_dioxide";
		Variable$1[Variable$1["ammonia"] = 81] = "ammonia";
		Variable$1[Variable$1["ozone"] = 82] = "ozone";
		Variable$1[Variable$1["sulphur_dioxide"] = 83] = "sulphur_dioxide";
		Variable$1[Variable$1["alder_pollen"] = 84] = "alder_pollen";
		Variable$1[Variable$1["birch_pollen"] = 85] = "birch_pollen";
		Variable$1[Variable$1["grass_pollen"] = 86] = "grass_pollen";
		Variable$1[Variable$1["mugwort_pollen"] = 87] = "mugwort_pollen";
		Variable$1[Variable$1["olive_pollen"] = 88] = "olive_pollen";
		Variable$1[Variable$1["ragweed_pollen"] = 89] = "ragweed_pollen";
		Variable$1[Variable$1["european_aqi"] = 90] = "european_aqi";
		Variable$1[Variable$1["european_aqi_pm2p5"] = 91] = "european_aqi_pm2p5";
		Variable$1[Variable$1["european_aqi_pm10"] = 92] = "european_aqi_pm10";
		Variable$1[Variable$1["european_aqi_nitrogen_dioxide"] = 93] = "european_aqi_nitrogen_dioxide";
		Variable$1[Variable$1["european_aqi_ozone"] = 94] = "european_aqi_ozone";
		Variable$1[Variable$1["european_aqi_sulphur_dioxide"] = 95] = "european_aqi_sulphur_dioxide";
		Variable$1[Variable$1["us_aqi"] = 96] = "us_aqi";
		Variable$1[Variable$1["us_aqi_pm2p5"] = 97] = "us_aqi_pm2p5";
		Variable$1[Variable$1["us_aqi_pm10"] = 98] = "us_aqi_pm10";
		Variable$1[Variable$1["us_aqi_nitrogen_dioxide"] = 99] = "us_aqi_nitrogen_dioxide";
		Variable$1[Variable$1["us_aqi_ozone"] = 100] = "us_aqi_ozone";
		Variable$1[Variable$1["us_aqi_sulphur_dioxide"] = 101] = "us_aqi_sulphur_dioxide";
		Variable$1[Variable$1["us_aqi_carbon_monoxide"] = 102] = "us_aqi_carbon_monoxide";
		Variable$1[Variable$1["sunshine_duration"] = 103] = "sunshine_duration";
		Variable$1[Variable$1["convective_inhibition"] = 104] = "convective_inhibition";
		Variable$1[Variable$1["shortwave_radiation_clear_sky"] = 105] = "shortwave_radiation_clear_sky";
		Variable$1[Variable$1["global_tilted_irradiance"] = 106] = "global_tilted_irradiance";
		Variable$1[Variable$1["global_tilted_irradiance_instant"] = 107] = "global_tilted_irradiance_instant";
		Variable$1[Variable$1["ocean_current_velocity"] = 108] = "ocean_current_velocity";
		Variable$1[Variable$1["ocean_current_direction"] = 109] = "ocean_current_direction";
		Variable$1[Variable$1["cloud_base"] = 110] = "cloud_base";
		Variable$1[Variable$1["cloud_top"] = 111] = "cloud_top";
		Variable$1[Variable$1["mass_density"] = 112] = "mass_density";
		Variable$1[Variable$1["boundary_layer_height"] = 113] = "boundary_layer_height";
		Variable$1[Variable$1["formaldehyde"] = 114] = "formaldehyde";
		Variable$1[Variable$1["glyoxal"] = 115] = "glyoxal";
		Variable$1[Variable$1["non_methane_volatile_organic_compounds"] = 116] = "non_methane_volatile_organic_compounds";
		Variable$1[Variable$1["pm10_wildfires"] = 117] = "pm10_wildfires";
		Variable$1[Variable$1["peroxyacyl_nitrates"] = 118] = "peroxyacyl_nitrates";
		Variable$1[Variable$1["secondary_inorganic_aerosol"] = 119] = "secondary_inorganic_aerosol";
		Variable$1[Variable$1["residential_elementary_carbon"] = 120] = "residential_elementary_carbon";
		Variable$1[Variable$1["total_elementary_carbon"] = 121] = "total_elementary_carbon";
		Variable$1[Variable$1["pm2_5_total_organic_matter"] = 122] = "pm2_5_total_organic_matter";
		Variable$1[Variable$1["sea_salt_aerosol"] = 123] = "sea_salt_aerosol";
		Variable$1[Variable$1["nitrogen_monoxide"] = 124] = "nitrogen_monoxide";
		Variable$1[Variable$1["thunderstorm_probability"] = 125] = "thunderstorm_probability";
		Variable$1[Variable$1["rain_probability"] = 126] = "rain_probability";
		Variable$1[Variable$1["freezing_rain_probability"] = 127] = "freezing_rain_probability";
		Variable$1[Variable$1["ice_pellets_probability"] = 128] = "ice_pellets_probability";
		Variable$1[Variable$1["snowfall_probability"] = 129] = "snowfall_probability";
		Variable$1[Variable$1["carbon_dioxide"] = 130] = "carbon_dioxide";
		Variable$1[Variable$1["methane"] = 131] = "methane";
		Variable$1[Variable$1["sea_level_height_msl"] = 132] = "sea_level_height_msl";
		Variable$1[Variable$1["sea_surface_temperature"] = 133] = "sea_surface_temperature";
		Variable$1[Variable$1["invert_barometer_height"] = 134] = "invert_barometer_height";
		Variable$1[Variable$1["hail"] = 135] = "hail";
		Variable$1[Variable$1["albedo"] = 136] = "albedo";
		Variable$1[Variable$1["precipitation_type"] = 137] = "precipitation_type";
		Variable$1[Variable$1["convective_cloud_base"] = 138] = "convective_cloud_base";
		Variable$1[Variable$1["convective_cloud_top"] = 139] = "convective_cloud_top";
		Variable$1[Variable$1["snow_depth_water_equivalent"] = 140] = "snow_depth_water_equivalent";
		Variable$1[Variable$1["secondary_swell_wave_height"] = 141] = "secondary_swell_wave_height";
		Variable$1[Variable$1["secondary_swell_wave_period"] = 142] = "secondary_swell_wave_period";
		Variable$1[Variable$1["secondary_swell_wave_peak_period"] = 143] = "secondary_swell_wave_peak_period";
		Variable$1[Variable$1["secondary_swell_wave_direction"] = 144] = "secondary_swell_wave_direction";
		Variable$1[Variable$1["tertiary_swell_wave_height"] = 145] = "tertiary_swell_wave_height";
		Variable$1[Variable$1["tertiary_swell_wave_period"] = 146] = "tertiary_swell_wave_period";
		Variable$1[Variable$1["tertiary_swell_wave_peak_period"] = 147] = "tertiary_swell_wave_peak_period";
		Variable$1[Variable$1["tertiary_swell_wave_direction"] = 148] = "tertiary_swell_wave_direction";
		Variable$1[Variable$1["wind_u_component"] = 149] = "wind_u_component";
		Variable$1[Variable$1["wind_v_component"] = 150] = "wind_v_component";
		Variable$1[Variable$1["temperature_max24h"] = 151] = "temperature_max24h";
		Variable$1[Variable$1["temperature_min24h"] = 152] = "temperature_min24h";
		Variable$1[Variable$1["temperature_mean24h"] = 153] = "temperature_mean24h";
		Variable$1[Variable$1["snow_density"] = 154] = "snow_density";
		Variable$1[Variable$1["longwave_radiation"] = 155] = "longwave_radiation";
		Variable$1[Variable$1["sea_ice_cover"] = 156] = "sea_ice_cover";
		Variable$1[Variable$1["k_index"] = 157] = "k_index";
		Variable$1[Variable$1["roughness_length"] = 158] = "roughness_length";
		Variable$1[Variable$1["potential_evapotranspiration"] = 159] = "potential_evapotranspiration";
		Variable$1[Variable$1["wave_peak_period"] = 160] = "wave_peak_period";
		Variable$1[Variable$1["temperature_max6h"] = 161] = "temperature_max6h";
		Variable$1[Variable$1["temperature_min6h"] = 162] = "temperature_min6h";
		Variable$1[Variable$1["lightning_density"] = 163] = "lightning_density";
		Variable$1[Variable$1["sea_ice_thickness"] = 164] = "sea_ice_thickness";
	})(Variable || (exports.Variable = Variable = {}));
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/variable-with-values.js
var require_variable_with_values = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/variable-with-values.js": ((exports) => {
	var __createBinding$3 = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault$3 = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar$3 = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			ownKeys = Object.getOwnPropertyNames || function(o$1) {
				var ar = [];
				for (var k in o$1) if (Object.prototype.hasOwnProperty.call(o$1, k)) ar[ar.length] = k;
				return ar;
			};
			return ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) {
				for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding$3(result, mod, k[i]);
			}
			__setModuleDefault$3(result, mod);
			return result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.VariableWithValues = void 0;
	var flatbuffers$3 = __importStar$3((init_flatbuffers(), __toCommonJS(flatbuffers_exports)));
	var aggregation_js_1 = require_aggregation();
	var probability_js_1 = require_probability();
	var unit_js_1 = require_unit();
	var variable_js_1 = require_variable();
	var VariableWithValues = class VariableWithValues {
		constructor() {
			this.bb = null;
			this.bb_pos = 0;
		}
		__init(i, bb) {
			this.bb_pos = i;
			this.bb = bb;
			return this;
		}
		static getRootAsVariableWithValues(bb, obj) {
			return (obj || new VariableWithValues()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
		}
		static getSizePrefixedRootAsVariableWithValues(bb, obj) {
			bb.setPosition(bb.position() + flatbuffers$3.SIZE_PREFIX_LENGTH);
			return (obj || new VariableWithValues()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
		}
		variable() {
			const offset = this.bb.__offset(this.bb_pos, 4);
			return offset ? this.bb.readUint8(this.bb_pos + offset) : variable_js_1.Variable.undefined;
		}
		unit() {
			const offset = this.bb.__offset(this.bb_pos, 6);
			return offset ? this.bb.readUint8(this.bb_pos + offset) : unit_js_1.Unit.undefined;
		}
		value() {
			const offset = this.bb.__offset(this.bb_pos, 8);
			return offset ? this.bb.readFloat32(this.bb_pos + offset) : 0;
		}
		values(index) {
			const offset = this.bb.__offset(this.bb_pos, 10);
			return offset ? this.bb.readFloat32(this.bb.__vector(this.bb_pos + offset) + index * 4) : 0;
		}
		valuesLength() {
			const offset = this.bb.__offset(this.bb_pos, 10);
			return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
		}
		valuesArray() {
			const offset = this.bb.__offset(this.bb_pos, 10);
			return offset ? new Float32Array(this.bb.bytes().buffer, this.bb.bytes().byteOffset + this.bb.__vector(this.bb_pos + offset), this.bb.__vector_len(this.bb_pos + offset)) : null;
		}
		valuesInt64(index) {
			const offset = this.bb.__offset(this.bb_pos, 12);
			return offset ? this.bb.readInt64(this.bb.__vector(this.bb_pos + offset) + index * 8) : BigInt(0);
		}
		valuesInt64Length() {
			const offset = this.bb.__offset(this.bb_pos, 12);
			return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
		}
		altitude() {
			const offset = this.bb.__offset(this.bb_pos, 14);
			return offset ? this.bb.readInt16(this.bb_pos + offset) : 0;
		}
		aggregation() {
			const offset = this.bb.__offset(this.bb_pos, 16);
			return offset ? this.bb.readUint8(this.bb_pos + offset) : aggregation_js_1.Aggregation.none;
		}
		pressureLevel() {
			const offset = this.bb.__offset(this.bb_pos, 18);
			return offset ? this.bb.readInt16(this.bb_pos + offset) : 0;
		}
		depth() {
			const offset = this.bb.__offset(this.bb_pos, 20);
			return offset ? this.bb.readInt16(this.bb_pos + offset) : 0;
		}
		depthTo() {
			const offset = this.bb.__offset(this.bb_pos, 22);
			return offset ? this.bb.readInt16(this.bb_pos + offset) : 0;
		}
		ensembleMember() {
			const offset = this.bb.__offset(this.bb_pos, 24);
			return offset ? this.bb.readInt16(this.bb_pos + offset) : 0;
		}
		previousDay() {
			const offset = this.bb.__offset(this.bb_pos, 26);
			return offset ? this.bb.readInt16(this.bb_pos + offset) : 0;
		}
		probability() {
			const offset = this.bb.__offset(this.bb_pos, 28);
			return offset ? this.bb.readUint8(this.bb_pos + offset) : probability_js_1.Probability.none;
		}
	};
	exports.VariableWithValues = VariableWithValues;
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/variables-with-month.js
var require_variables_with_month = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/variables-with-month.js": ((exports) => {
	var __createBinding$2 = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault$2 = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar$2 = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			ownKeys = Object.getOwnPropertyNames || function(o$1) {
				var ar = [];
				for (var k in o$1) if (Object.prototype.hasOwnProperty.call(o$1, k)) ar[ar.length] = k;
				return ar;
			};
			return ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) {
				for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding$2(result, mod, k[i]);
			}
			__setModuleDefault$2(result, mod);
			return result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.VariablesWithMonth = void 0;
	var flatbuffers$2 = __importStar$2((init_flatbuffers(), __toCommonJS(flatbuffers_exports)));
	var variable_with_values_js_1$1 = require_variable_with_values();
	var VariablesWithMonth = class VariablesWithMonth {
		constructor() {
			this.bb = null;
			this.bb_pos = 0;
		}
		__init(i, bb) {
			this.bb_pos = i;
			this.bb = bb;
			return this;
		}
		static getRootAsVariablesWithMonth(bb, obj) {
			return (obj || new VariablesWithMonth()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
		}
		static getSizePrefixedRootAsVariablesWithMonth(bb, obj) {
			bb.setPosition(bb.position() + flatbuffers$2.SIZE_PREFIX_LENGTH);
			return (obj || new VariablesWithMonth()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
		}
		year() {
			const offset = this.bb.__offset(this.bb_pos, 4);
			return offset ? this.bb.readInt16(this.bb_pos + offset) : 0;
		}
		month() {
			const offset = this.bb.__offset(this.bb_pos, 6);
			return offset ? this.bb.readInt8(this.bb_pos + offset) : 0;
		}
		count() {
			const offset = this.bb.__offset(this.bb_pos, 8);
			return offset ? this.bb.readInt32(this.bb_pos + offset) : 0;
		}
		variables(index, obj) {
			const offset = this.bb.__offset(this.bb_pos, 10);
			return offset ? (obj || new variable_with_values_js_1$1.VariableWithValues()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
		}
		variablesLength() {
			const offset = this.bb.__offset(this.bb_pos, 10);
			return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
		}
	};
	exports.VariablesWithMonth = VariablesWithMonth;
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/variables-with-time.js
var require_variables_with_time = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/variables-with-time.js": ((exports) => {
	var __createBinding$1 = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault$1 = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar$1 = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			ownKeys = Object.getOwnPropertyNames || function(o$1) {
				var ar = [];
				for (var k in o$1) if (Object.prototype.hasOwnProperty.call(o$1, k)) ar[ar.length] = k;
				return ar;
			};
			return ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) {
				for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding$1(result, mod, k[i]);
			}
			__setModuleDefault$1(result, mod);
			return result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.VariablesWithTime = void 0;
	var flatbuffers$1 = __importStar$1((init_flatbuffers(), __toCommonJS(flatbuffers_exports)));
	var variable_with_values_js_1 = require_variable_with_values();
	var VariablesWithTime = class VariablesWithTime {
		constructor() {
			this.bb = null;
			this.bb_pos = 0;
		}
		__init(i, bb) {
			this.bb_pos = i;
			this.bb = bb;
			return this;
		}
		static getRootAsVariablesWithTime(bb, obj) {
			return (obj || new VariablesWithTime()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
		}
		static getSizePrefixedRootAsVariablesWithTime(bb, obj) {
			bb.setPosition(bb.position() + flatbuffers$1.SIZE_PREFIX_LENGTH);
			return (obj || new VariablesWithTime()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
		}
		time() {
			const offset = this.bb.__offset(this.bb_pos, 4);
			return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("0");
		}
		timeEnd() {
			const offset = this.bb.__offset(this.bb_pos, 6);
			return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("0");
		}
		interval() {
			const offset = this.bb.__offset(this.bb_pos, 8);
			return offset ? this.bb.readInt32(this.bb_pos + offset) : 0;
		}
		variables(index, obj) {
			const offset = this.bb.__offset(this.bb_pos, 10);
			return offset ? (obj || new variable_with_values_js_1.VariableWithValues()).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos + offset) + index * 4), this.bb) : null;
		}
		variablesLength() {
			const offset = this.bb.__offset(this.bb_pos, 10);
			return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
		}
	};
	exports.VariablesWithTime = VariablesWithTime;
}) });

//#endregion
//#region node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/weather-api-response.js
var require_weather_api_response = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/@openmeteo+sdk@1.25.0/node_modules/@openmeteo/sdk/weather-api-response.js": ((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar = exports && exports.__importStar || (function() {
		var ownKeys = function(o) {
			ownKeys = Object.getOwnPropertyNames || function(o$1) {
				var ar = [];
				for (var k in o$1) if (Object.prototype.hasOwnProperty.call(o$1, k)) ar[ar.length] = k;
				return ar;
			};
			return ownKeys(o);
		};
		return function(mod) {
			if (mod && mod.__esModule) return mod;
			var result = {};
			if (mod != null) {
				for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
			}
			__setModuleDefault(result, mod);
			return result;
		};
	})();
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.WeatherApiResponse = void 0;
	var flatbuffers = __importStar((init_flatbuffers(), __toCommonJS(flatbuffers_exports)));
	var model_js_1 = require_model();
	var variables_with_month_js_1 = require_variables_with_month();
	var variables_with_time_js_1 = require_variables_with_time();
	var WeatherApiResponse = class WeatherApiResponse {
		constructor() {
			this.bb = null;
			this.bb_pos = 0;
		}
		__init(i, bb) {
			this.bb_pos = i;
			this.bb = bb;
			return this;
		}
		static getRootAsWeatherApiResponse(bb, obj) {
			return (obj || new WeatherApiResponse()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
		}
		static getSizePrefixedRootAsWeatherApiResponse(bb, obj) {
			bb.setPosition(bb.position() + flatbuffers.SIZE_PREFIX_LENGTH);
			return (obj || new WeatherApiResponse()).__init(bb.readInt32(bb.position()) + bb.position(), bb);
		}
		latitude() {
			const offset = this.bb.__offset(this.bb_pos, 4);
			return offset ? this.bb.readFloat32(this.bb_pos + offset) : 0;
		}
		longitude() {
			const offset = this.bb.__offset(this.bb_pos, 6);
			return offset ? this.bb.readFloat32(this.bb_pos + offset) : 0;
		}
		elevation() {
			const offset = this.bb.__offset(this.bb_pos, 8);
			return offset ? this.bb.readFloat32(this.bb_pos + offset) : 0;
		}
		generationTimeMilliseconds() {
			const offset = this.bb.__offset(this.bb_pos, 10);
			return offset ? this.bb.readFloat32(this.bb_pos + offset) : 0;
		}
		locationId() {
			const offset = this.bb.__offset(this.bb_pos, 12);
			return offset ? this.bb.readInt64(this.bb_pos + offset) : BigInt("0");
		}
		model() {
			const offset = this.bb.__offset(this.bb_pos, 14);
			return offset ? this.bb.readUint8(this.bb_pos + offset) : model_js_1.Model.undefined;
		}
		utcOffsetSeconds() {
			const offset = this.bb.__offset(this.bb_pos, 16);
			return offset ? this.bb.readInt32(this.bb_pos + offset) : 0;
		}
		timezone(optionalEncoding) {
			const offset = this.bb.__offset(this.bb_pos, 18);
			return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
		}
		timezoneAbbreviation(optionalEncoding) {
			const offset = this.bb.__offset(this.bb_pos, 20);
			return offset ? this.bb.__string(this.bb_pos + offset, optionalEncoding) : null;
		}
		current(obj) {
			const offset = this.bb.__offset(this.bb_pos, 22);
			return offset ? (obj || new variables_with_time_js_1.VariablesWithTime()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
		}
		daily(obj) {
			const offset = this.bb.__offset(this.bb_pos, 24);
			return offset ? (obj || new variables_with_time_js_1.VariablesWithTime()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
		}
		hourly(obj) {
			const offset = this.bb.__offset(this.bb_pos, 26);
			return offset ? (obj || new variables_with_time_js_1.VariablesWithTime()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
		}
		minutely15(obj) {
			const offset = this.bb.__offset(this.bb_pos, 28);
			return offset ? (obj || new variables_with_time_js_1.VariablesWithTime()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
		}
		monthly(obj) {
			const offset = this.bb.__offset(this.bb_pos, 30);
			return offset ? (obj || new variables_with_month_js_1.VariablesWithMonth()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
		}
	};
	exports.WeatherApiResponse = WeatherApiResponse;
}) });

//#endregion
//#region node_modules/.pnpm/openmeteo@1.2.3/node_modules/openmeteo/lib/index.js
var require_lib = /* @__PURE__ */ __commonJS({ "node_modules/.pnpm/openmeteo@1.2.3/node_modules/openmeteo/lib/index.js": ((exports) => {
	var __awaiter = exports && exports.__awaiter || function(thisArg, _arguments, P, generator) {
		function adopt(value) {
			return value instanceof P ? value : new P(function(resolve) {
				resolve(value);
			});
		}
		return new (P || (P = Promise))(function(resolve, reject) {
			function fulfilled(value) {
				try {
					step(generator.next(value));
				} catch (e) {
					reject(e);
				}
			}
			function rejected(value) {
				try {
					step(generator["throw"](value));
				} catch (e) {
					reject(e);
				}
			}
			function step(result) {
				result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
			}
			step((generator = generator.apply(thisArg, _arguments || [])).next());
		});
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.fetchWeatherApi = fetchWeatherApi;
	var flatbuffers_1 = (init_flatbuffers(), __toCommonJS(flatbuffers_exports));
	var weather_api_response_1 = require_weather_api_response();
	var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
	function fetchRetried(url_1) {
		return __awaiter(this, arguments, void 0, function* (url, retries = 3, backoffFactor = .5, backoffMax = 2, fetchOptions = {}) {
			const statusToRetry = [
				500,
				502,
				504
			];
			const statusWithJsonError = [400, 429];
			let currentTry = 0;
			let response = yield fetch(url, fetchOptions);
			while (statusToRetry.includes(response.status)) {
				currentTry++;
				if (currentTry >= retries) throw new Error(response.statusText);
				yield sleep(Math.min(backoffFactor * Math.pow(2, currentTry), backoffMax) * 1e3);
				response = yield fetch(url, fetchOptions);
			}
			if (statusWithJsonError.includes(response.status)) {
				const json = yield response.json();
				if ("reason" in json) throw new Error(json.reason);
				throw new Error(response.statusText);
			}
			return response;
		});
	}
	/**
	* Retrieve data from the Open-Meteo weather API
	*
	* @param {string} url Server and endpoint. E.g. "https://api.open-meteo.com/v1/forecast"
	* @param {any} params URL parameter as an object
	* @param {number} [retries=3] Number of retries in case of an server error
	* @param {number} [backoffFactor=0.2] Exponential backoff factor to increase wait time after each retry
	* @param {number} [backoffMax=2] Maximum wait time between retries
	* @param {RequestInit} [fetchOptions={}] Additional fetch options such as headers, signal, etc.
	* @returns {Promise<WeatherApiResponse[]>}
	*/
	function fetchWeatherApi(url_1, params_1) {
		return __awaiter(this, arguments, void 0, function* (url, params, retries = 3, backoffFactor = .2, backoffMax = 2, fetchOptions = {}) {
			const urlParams = new URLSearchParams(params);
			urlParams.set("format", "flatbuffers");
			const response = yield fetchRetried(`${url}?${urlParams.toString()}`, retries, backoffFactor, backoffMax, fetchOptions);
			const fb = new flatbuffers_1.ByteBuffer(new Uint8Array(yield response.arrayBuffer()));
			const results = [];
			let pos = 0;
			while (pos < fb.capacity()) {
				fb.setPosition(pos);
				const len = fb.readInt32(fb.position());
				results.push(weather_api_response_1.WeatherApiResponse.getSizePrefixedRootAsWeatherApiResponse(fb));
				pos += len + 4;
			}
			return results;
		});
	}
}) });

//#endregion
export default require_lib();

//# sourceMappingURL=openmeteo.js.map