(function (exports) {

    exports.OcclusionCulling = OcclusionCulling;

    function OcclusionCulling() {
        var blocks = [];
        var mipmaps = [];
        var numBlocksX = 0;
        var numBlocksY = 0;
        var w = 0;
        var h = 0;
        var fullyCoveredBlock;
        var mipMapsDirty = true;

        this.renderBackfaces = true;

        // TODO: use own vectors. glMatrix?
        var triangleIsOccluded_va = [0,0,0,1];
        var triangleIsOccluded_vb = [0,0,0,1];
        var triangleIsOccluded_vc = [0,0,0,1];
        var drawTriangleToZPyramid_va = [0,0,0,1];
        var drawTriangleToZPyramid_vb = [0,0,0,1];
        var drawTriangleToZPyramid_vc = [0,0,0,1];
        var renderTriangles_va = [0,0,0,1];
        var renderTriangles_vb = [0,0,0,1];
        var renderTriangles_vc = [0,0,0,1];

        this.setResolution = function (width, height) {
            w = width;
            h = height;

            // Init blocks
            blockSizeX = 1;
            blockSizeY = 1;
            blocks.length = 0;
            numBlocksX = Math.ceil(w / blockSizeX);
            numBlocksY = Math.ceil(h / blockSizeY);
            for (var j = 0; j < numBlocksY * numBlocksX; j++) {
                blocks.push(new Block());
            }

            fullyCoveredBlock = (~0) >>> (32 - blockSizeX);

            // Init mipmaps
            mipmaps.length = 0;
            var mipSize = w;
            while (mipSize > 2) {
                mipmaps.push(new Float32Array(mipSize * mipSize));
                mipSize /= 2;
            }
            mipMapsDirty = true;
        }

        this.ndcRectIsOccluded = function (x0, x1, y0, y1, closestDepth) {

            updateMipMaps();

            // Convert to screen space (0 to 1)
            x0 = (x0 + 1) * 0.5;
            x1 = (x1 + 1) * 0.5;
            y0 = (y0 + 1) * 0.5;
            y1 = (y1 + 1) * 0.5;

            closestDepth = (closestDepth + 1) * 0.5;

            if(closestDepth > 1) return false;

            for (var i = mipmaps.length - 1; i >= 0; i--) {
                var mipmap = mipmaps[i];
                var mipMapSize = Math.sqrt(mipmap.length); // TODO: Support non-square

                var minx = Math.floor(x0 * mipMapSize);
                var maxx = Math.ceil(x1 * mipMapSize);
                var miny = Math.floor(y0 * mipMapSize);
                var maxy = Math.ceil(y1 * mipMapSize);

                if (maxx < 0 || maxy < 0 || minx >= mipMapSize || miny >= mipMapSize) {
                    return false; // triangle is out of the screen. Can't determine if it's occluded. Should not cull!
                }

                minx = clamp(minx, 0, mipMapSize - 1);
                maxx = clamp(maxx, 0, mipMapSize - 1);
                miny = clamp(miny, 0, mipMapSize - 1);
                maxy = clamp(maxy, 0, mipMapSize - 1);

                var behindOccluder = true;
                for (var x = minx; x <= maxx; x++) {
                    for (var y = miny; y <= maxy; y++) {
                        var depth = mipmap[y * mipMapSize + x];
                        if (closestDepth < depth) {
                            // behind occluder. Rectangle is definitely occluded and we dont need to check next mipmap!
                            behindOccluder = false;
                        }
                    }
                }
                if (behindOccluder) {
                    return true;
                }
            }

            // Triangle was checked against all mipmaps but it wasn't occluded by any.
            return false;
        }

        this.clear = function() {
            blocks.forEach((b) => {
                b.clear();
            });
        };

        function updateMipMaps() {
            if(!mipMapsDirty) return;

            // Update first mipmap
            var mipSize = w;
            for (var py = 0; py < mipSize; py++) {
                for (var px = 0; px < mipSize; px++) {
                    var mipPosition = py * mipSize + px;
                    var blockX = Math.floor(px / blockSizeX);
                    var blockY = Math.floor(py / blockSizeY);
                    var block = blocks[blockY * numBlocksX + blockX];
                    var pixelOffset = px - blockX * blockSizeX;
                    var pixelBit = (1 << pixelOffset);
                    var depth = (block.coverageMask & pixelBit) ? block.zMax1 : block.zMax0;
                    mipmaps[0][mipPosition] = depth;
                }
            }

            // Update smaller mipmaps
            var mipSize = w / 2;
            var mipIndex = 1;
            while (mipSize > 2) {
                for (var py = 0; py < mipSize; py++) {
                    for (var px = 0; px < mipSize; px++) {
                        var mipPosition = py * mipSize + px;
                        var depth0 = mipmaps[mipIndex - 1][(2 * py) * 2 * mipSize + 2 * px];
                        var depth1 = mipmaps[mipIndex - 1][(2 * py + 1) * 2 * mipSize + 2 * px];
                        var depth2 = mipmaps[mipIndex - 1][(2 * py) * 2 * mipSize + 2 * px + 1];
                        var depth3 = mipmaps[mipIndex - 1][(2 * py + 1) * 2 * mipSize + 2 * px + 1];
                        mipmaps[mipIndex][mipPosition] = Math.max(depth0, depth1, depth2, depth3); // use the furthest away depth
                    }
                }
                mipSize /= 2;
                mipIndex++;
            }

            mipMapsDirty = false;
        }

        function applyMatrix4ToVector4(vector, matrix){
            var x = vector[0], y = vector[1], z = vector[2], w = vector[3];
            var e = matrix;

            vector[0] = e[ 0 ] * x + e[ 4 ] * y + e[ 8 ] * z + e[ 12 ] * w;
            vector[1] = e[ 1 ] * x + e[ 5 ] * y + e[ 9 ] * z + e[ 13 ] * w;
            vector[2] = e[ 2 ] * x + e[ 6 ] * y + e[ 10 ] * z + e[ 14 ] * w;
            vector[3] = e[ 3 ] * x + e[ 7 ] * y + e[ 11 ] * z + e[ 15 ] * w;
        }
        function vectorSet(v,x,y,z,w){
            v[0] = x;
            v[1] = y;
            v[2] = z;
            v[3] = w;
        }
        function vectorDivideScalar(v,s){
            var is = 1/s;
            v[0] *= is;
            v[1] *= is;
            v[2] *= is;
            v[3] *= is;
        }

        this.renderTriangles = function( indices, vertices, matrix ){
            mipMapsDirty = true;

            var va = renderTriangles_va;
            var vb = renderTriangles_vb;
            var vc = renderTriangles_vc;
            for(var i=0; i<indices.length; i+=3){
                vectorSet(va, vertices[indices[i+0]*3+0], vertices[indices[i+0]*3+1], vertices[indices[i+0]*3+2],1);
                vectorSet(vb, vertices[indices[i+1]*3+0], vertices[indices[i+1]*3+1], vertices[indices[i+1]*3+2],1);
                vectorSet(vc, vertices[indices[i+2]*3+0], vertices[indices[i+2]*3+1], vertices[indices[i+2]*3+2],1);
                applyMatrix4ToVector4( va, matrix );
                applyMatrix4ToVector4( vb, matrix );
                applyMatrix4ToVector4( vc, matrix );
                vectorDivideScalar(va,va[3]); //divide by w
                vectorDivideScalar(vb,vb[3]);
                vectorDivideScalar(vc,vc[3]);

                if(ndcTriangleIsInUnitBoxArray(va,vb,vc)){
                    this.drawTriangleToZPyramid(va,vb,vc);
                }
            }
        };

        this.drawTriangleToZPyramid = function (a, b, c) {
            mipMapsDirty = true;

            var va = drawTriangleToZPyramid_va;
            var vb = drawTriangleToZPyramid_vb;
            var vc = drawTriangleToZPyramid_vc;

            // Convert to screen space (0 to 1)
            ndcTo01ArrayVector(va, a);
            ndcTo01ArrayVector(vb, b);
            ndcTo01ArrayVector(vc, c);

            // backface culling
            if (!checkBackfaceCullingArray(va, vb, vc)) {
                if (!this.renderBackfaces) return;

                // Flip the triangle to render its back face
                var temp = va;
                va = vb;
                vb = temp;
            }

            var triangleZMax = Math.max(va[2], vb[2], vc[2]);

            if (triangleZMax < 0 || triangleZMax > 1) return; // Near/far plane clip

            var ax = Math.floor(va[0] * w);
            var ay = Math.floor(va[1] * h);
            var bx = Math.floor(vb[0] * w);
            var by = Math.floor(vb[1] * h);
            var cx = Math.floor(vc[0] * w);
            var cy = Math.floor(vc[1] * h);

            // Get xy bounds for triangle
            var minx = Math.min(ax, bx, cx);
            var maxx = Math.max(ax, bx, cx);
            var miny = Math.min(ay, by, cy);
            var maxy = Math.max(ay, by, cy);

            if (maxx < 0 || maxy < 0 || minx > w || miny > h) {
                return false; // out of screen. Dont render!
            }

            minx = clamp(minx, 0, w);
            maxx = clamp(maxx, 0, w);
            miny = clamp(miny, 0, h);
            maxy = clamp(maxy, 0, h);
            var jmin = Math.floor(miny / blockSizeY);
            var jmax = Math.ceil(maxy / blockSizeY);
            var loops = 0;
            for (var j = jmin; j < jmax; j++) {
                var y = blockSizeY * j / h;
                var xIntersect0 = getXAxisIntersection(va[0], va[1], vb[0], vb[1], y);
                var xIntersect1 = getXAxisIntersection(vb[0], vb[1], vc[0], vc[1], y);
                var xIntersect2 = getXAxisIntersection(vc[0], vc[1], va[0], va[1], y);

                var kmin = Math.floor(minx / blockSizeX);
                var kmax = Math.ceil(maxx / blockSizeX);
                for (var k = kmin; k < kmax; k++) {
                    var blockIndex = j * numBlocksX + k;
                    var block = blocks[blockIndex];

                    var x = blockSizeX * k / w;

                    var mask0 = getLineMask(va[0], va[1], vb[0], vb[1], vc[0], vc[1], x, y, xIntersect0);
                    var mask1 = getLineMask(vb[0], vb[1], vc[0], vc[1], va[0], va[1], x, y, xIntersect1);
                    var mask2 = getLineMask(vc[0], vc[1], va[0], va[1], vb[0], vb[1], x, y, xIntersect2);

                    var triangleCoverageMask = mask0 & mask1 & mask2;
                    updateHiZBuffer(block, triangleZMax, triangleCoverageMask);
                }
            }
        }

        this.triangleIsOccluded = function(a, b, c) {
            updateMipMaps();

            var va = triangleIsOccluded_va;
            var vb = triangleIsOccluded_vb;
            var vc = triangleIsOccluded_vc;

            // Convert to screen space (0 to 1)
            ndcTo01ArrayVector(va, a);
            ndcTo01ArrayVector(vb, b);
            ndcTo01ArrayVector(vc, c);

            var triangleClosestDepth = Math.min(va[0], vb[0], vc[0]);
            for (var i = mipmaps.length - 1; i >= 0; i--) {
                var mipmap = mipmaps[i];
                var mipMapSize = Math.sqrt(mipmap.length); // TODO: Support non-square

                var ax = Math.floor(va[0] * mipMapSize);
                var ay = Math.floor(va[1] * mipMapSize);
                var bx = Math.floor(vb[0] * mipMapSize);
                var by = Math.floor(vb[1] * mipMapSize);
                var cx = Math.floor(vc[0] * mipMapSize);
                var cy = Math.floor(vc[1] * mipMapSize);

                // TODO: this can probably be done once for the largest mip. And then divided by 2 per step.
                // Get xy bounds for triangle
                var minx = Math.min(ax, bx, cx);
                var maxx = Math.max(ax, bx, cx);
                var miny = Math.min(ay, by, cy);
                var maxy = Math.max(ay, by, cy);
                if (maxx < 0 || maxy < 0 || minx >= mipMapSize || miny >= mipMapSize) {
                    return false; // triangle is out of the screen. Can't determine if it's occluded. Should not cull!
                }

                minx = clamp(minx, 0, mipMapSize - 1);
                maxx = clamp(maxx, 0, mipMapSize - 1);
                miny = clamp(miny, 0, mipMapSize - 1);
                maxy = clamp(maxy, 0, mipMapSize - 1);

                var behindOccluder = false;
                for (var x = minx; x <= maxx; x++) {
                    for (var y = miny; y <= maxy; y++) {
                        var depth = mipmap[y * mipMapSize + x];
                        if (triangleClosestDepth > depth) {
                            // triangle is behind occluder. Triangle is definitely occluded and we dont need to check next mipmap!
                            return true;
                        }
                    }
                }
            }

            // Triangle was checked against all mipmaps but it wasn't occluded by any.
            return false;
        }

        this.renderToImageDataArray = function(array){
            // Render mips
            var mipSize = w;
            var mipIndex = 0;
            var dataX = 0;
            while(mipSize>2){
                for(var py=0; py<mipSize; py++){
                    for(var px=0; px<mipSize; px++){
                        var mipPosition = py*mipSize + px;
                        var depth = mipmaps[mipIndex][mipPosition];
                        var dataOffset = 4*((mipSize-py-1)*w*2 + dataX+px); // render upside down
                        array[dataOffset+0] = 255*(depth);
                        array[dataOffset+1] = 255*(depth);
                        array[dataOffset+2] = 255*(depth);
                        array[dataOffset+3] = 255;
                    }
                }
                dataX += mipSize;
                mipSize /= 2;
                mipIndex++;
            }
        }

        function updateHiZBuffer(block, triangleZMax, triangleCoverageMask) {
            var dist1t = block.zMax1 - triangleZMax;
            var dist01 = block.zMax0 - block.zMax1;

            if(dist1t > dist01){
                block.zMax1 = 0;
                block.coverageMask = 0;
            }

            block.zMax1 = Math.max(block.zMax1, triangleZMax);
            block.coverageMask |= triangleCoverageMask;

            if (block.coverageMask === fullyCoveredBlock) {
                block.zMax0 = block.zMax1;
                block.zMax1 = 0;
                block.coverageMask = 0;
            }
        }

        function getLineMask(ax, ay, bx, by, cx, cy, x, y, x0) {
            // Calculate intersection with the x axis
            // y = k * x + m
            // x = (y - m) / k
            // k = (y - m) / x
            // m = y - k * x
            var xpixels = Math.max(0, Math.floor((x0 - x) * w + 0.5 + (ay < by ? -.5 : .5)));
            var mask = 0;
            if (xpixels >= 1 && xpixels <= blockSizeX) {
                mask = (~(fullyCoveredBlock >>> (-xpixels))) & fullyCoveredBlock;
            } else if (xpixels <= 0) {
                mask = fullyCoveredBlock;
            } else if (xpixels > blockSizeX) {
                mask = 0;
            }
            if (ay <= by) mask = (~mask) & fullyCoveredBlock;
            //if((bx-ax)*(cy-ay) - (by-ay)*(cx-ax) > 0) mask = ~mask; // fix for back faces?
            return mask;
        }
    }

    function Block() {
        this.clear();
    }
    Block.prototype = {
        clear: function () {
            this.coverageMask = 0;
            this.zMax0 = 1;
            this.zMax1 = 0;
        }
    };


    function objectIsOccluded( indices, vertices, matrix ) {
        updateMipMaps();

        var numTrianglesInView = 0;

        var va = objectIsOccluded_va;
        var vb = objectIsOccluded_vb;
        var vc = objectIsOccluded_vc;
        for(var i=0; i<indices.length; i+=3){
            vectorSet(va, vertices[indices[i+0]*3+0], vertices[indices[i+0]*3+1], vertices[indices[i+0]*3+2],1);
            vectorSet(vb, vertices[indices[i+1]*3+0], vertices[indices[i+1]*3+1], vertices[indices[i+1]*3+2],1);
            vectorSet(vc, vertices[indices[i+2]*3+0], vertices[indices[i+2]*3+1], vertices[indices[i+2]*3+2],1);
            applyMatrix4ToVector4( va, matrix );
            applyMatrix4ToVector4( vb, matrix );
            applyMatrix4ToVector4( vc, matrix );
            vectorDivideScalar(va,va[3]); //divide by w
            vectorDivideScalar(vb,vb[3]);
            vectorDivideScalar(vc,vc[3]);

            if(!ndcTriangleIsInUnitBoxArray(va,vb,vc)){
                continue;
            }

            numTrianglesInView++;

            // Cull in screen space
            if (!triangleIsOccluded(va, vb, vc)) {
                return false;
            }
            // If at least one triangle is in view, but we get here, it means that it was occluded
            return numTrianglesInView > 0;
        }
    }

    function checkBackfaceCullingArray(v1, v2, v3) {
        return ((v3[0] - v1[0]) * (v2[1] - v1[1]) - (v3[1] - v1[1]) * (v2[0] - v1[0])) < 0;
    }
    function clamp(x, min, max) { return Math.min(Math.max(x, min), max); }
    function ndcTriangleIsInUnitBoxArray(a, b, c) {
        return (
            (Math.min(a[0], b[0], c[0]) > -1 && Math.max(a[0], b[0], c[0]) < 1) ||
            (Math.min(a[1], b[1], c[1]) > -1 && Math.max(a[1], b[1], c[1]) < 1) ||
            (Math.min(a[2], b[2], c[2]) > -1 && Math.max(a[2], b[2], c[2]) < 1)
        );
    }

    function ndcTo01ArrayVector(out, point) {
        out[0] = (point[0] + 1) * 0.5;
        out[1] = (point[1] + 1) * 0.5;
        out[2] = (point[2] + 1) * 0.5;
    }

    function getXAxisIntersection(ax, ay, bx, by, y) {
        var x0 = ax;
        if (bx != ax) {
            var k0 = (by - ay) / (bx - ax);
            var m0 = ay - k0 * ax;
            x0 = (y - m0) / k0;
        }
        return x0;
    }


})(window);