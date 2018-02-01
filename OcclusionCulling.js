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

        this.renderBackfaces = true;

        // TODO: use own vectors. glMatrix?
        var triangleIsOccluded_va = new THREE.Vector4();
        var triangleIsOccluded_vb = new THREE.Vector4();
        var triangleIsOccluded_vc = new THREE.Vector4();
        var drawTriangleToZPyramid_va = new THREE.Vector4();
        var drawTriangleToZPyramid_vb = new THREE.Vector4();
        var drawTriangleToZPyramid_vc = new THREE.Vector4();

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
        }

        this.ndcRectIsOccluded = function (x0, x1, y0, y1, closestDepth) {

            // Convert to screen space (0 to 1)
            x0 = (x0 + 1) * 0.5;
            x1 = (x1 + 1) * 0.5;
            y0 = (y0 + 1) * 0.5;
            y1 = (y1 + 1) * 0.5;

            closestDepth = (closestDepth + 1) * 0.5;

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

        this.updateMipMaps = function() {
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
        }
        
        this.drawTriangleToZPyramid = function (a, b, c) {
            var va = drawTriangleToZPyramid_va;
            var vb = drawTriangleToZPyramid_vb;
            var vc = drawTriangleToZPyramid_vc;

            // Convert to screen space (0 to 1)
            ndcTo01(va, a);
            ndcTo01(vb, b);
            ndcTo01(vc, c);

            // backface culling
            if (!checkBackfaceCulling(va, vb, vc)) {
                if (!this.renderBackfaces) return;

                // Flip the triangle to render its back face
                var temp = va;
                va = vb;
                vb = temp;
            }

            var triangleZMax = Math.max(va.z, vb.z, vc.z);

            if (triangleZMax < 0 || triangleZMax > 1) return; // Near/far plane clip

            var ax = Math.floor(va.x * w);
            var ay = Math.floor(va.y * h);
            var bx = Math.floor(vb.x * w);
            var by = Math.floor(vb.y * h);
            var cx = Math.floor(vc.x * w);
            var cy = Math.floor(vc.y * h);

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
                var xIntersect0 = getXAxisIntersection(va.x, va.y, vb.x, vb.y, y);
                var xIntersect1 = getXAxisIntersection(vb.x, vb.y, vc.x, vc.y, y);
                var xIntersect2 = getXAxisIntersection(vc.x, vc.y, va.x, va.y, y);

                var kmin = Math.floor(minx / blockSizeX);
                var kmax = Math.ceil(maxx / blockSizeX);
                for (var k = kmin; k < kmax; k++) {
                    var blockIndex = j * numBlocksX + k;
                    var block = blocks[blockIndex];

                    var x = blockSizeX * k / w;

                    var mask0 = getLineMask(va.x, va.y, vb.x, vb.y, vc.x, vc.y, x, y, xIntersect0);
                    var mask1 = getLineMask(vb.x, vb.y, vc.x, vc.y, va.x, va.y, x, y, xIntersect1);
                    var mask2 = getLineMask(vc.x, vc.y, va.x, va.y, vb.x, vb.y, x, y, xIntersect2);

                    var triangleCoverageMask = mask0 & mask1 & mask2;
                    updateHiZBuffer(block, triangleZMax, triangleCoverageMask);
                }
            }
        }

        this.triangleIsOccluded = function(a, b, c) {
            var va = triangleIsOccluded_va;
            var vb = triangleIsOccluded_vb;
            var vc = triangleIsOccluded_vc;

            // Convert to screen space (0 to 1)
            ndcTo01(va, a);
            ndcTo01(vb, b);
            ndcTo01(vc, c);

            var triangleClosestDepth = Math.min(va.z, vb.z, vc.z);
            for (var i = mipmaps.length - 1; i >= 0; i--) {
                var mipmap = mipmaps[i];
                var mipMapSize = Math.sqrt(mipmap.length); // TODO: Support non-square

                var ax = Math.floor(va.x * mipMapSize);
                var ay = Math.floor(va.y * mipMapSize);
                var bx = Math.floor(vb.x * mipMapSize);
                var by = Math.floor(vb.y * mipMapSize);
                var cx = Math.floor(vc.x * mipMapSize);
                var cy = Math.floor(vc.y * mipMapSize);

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
                    array[dataOffset+0] = 255*depth;
                    array[dataOffset+1] = 255*depth;
                    array[dataOffset+2] = 255*depth;
                    array[dataOffset+3] = 255;
                }
                }
                dataX += mipSize;
                mipSize /= 2;
                mipIndex++;
            }
        }
    }

    function Block() {
        this.coverageMask = 1;
        this.zMax1 = 0;
        this.zMax0 = 0;
        this.clear();
    }
    Block.prototype = {
        clear: function () {
            this.coverageMask = 0;
            this.zMax0 = 1;
            this.zMax1 = 1;
        }
    };


    // TODO: should take a list of triangles and a matrix as arguments.
    function objectIsOccluded(object) {
        var numTrianglesInView = 0;
        mvpMatrix.multiplyMatrices(viewProjectionMatrix, object.matrixWorld);

        // TODO: transform all 8 aabb corners first. Then do the following
        for (var i = 0; i < object.geometry.faces.length; i++) {
            var face = object.geometry.faces[i];
            va.copy(object.geometry.vertices[face.a]);
            vb.copy(object.geometry.vertices[face.b]);
            vc.copy(object.geometry.vertices[face.c]);
            va.w = vb.w = vc.w = 1;
            va.applyMatrix4(mvpMatrix);
            vb.applyMatrix4(mvpMatrix);
            vc.applyMatrix4(mvpMatrix);
            va.divideScalar(va.w);
            vb.divideScalar(vb.w);
            vc.divideScalar(vc.w);

            // Within the clipping box?
            if (!ndcTriangleIsInUnitBox(va, vb, vc)) {
                continue;
            }

            numTrianglesInView++;

            // Cull in screen space
            if (!triangleIsOccluded(va, vb, vc)) {
                return false;
            }
        }

        // If at least one triangle is in view, but we get here, it means that it was occluded
        return numTrianglesInView > 0;
    }


    function checkBackfaceCulling(v1, v2, v3) {
        return ((v3.x - v1.x) * (v2.y - v1.y) - (v3.y - v1.y) * (v2.x - v1.x)) < 0;
    }
    function clamp(x, min, max) { return Math.min(Math.max(x, min), max); }
    
    function ndcTriangleIsInUnitBox(a, b, c) {
        return (
            (Math.min(a.x, b.x, c.x) > -1 && Math.max(a.x, b.x, c.x) < 1) ||
            (Math.min(a.y, b.y, c.y) > -1 && Math.max(a.y, b.y, c.y) < 1) ||
            (Math.min(a.z, b.z, c.z) > -1 && Math.max(a.z, b.z, c.z) < 1)
        );
    }

    function updateHiZBuffer(block, triangleZMax, triangleCoverageMask) {
        var dist1t = block.zMax1 - triangleZMax;
        var dist01 = block.zMax0 - block.zMax1;
        /* if(dist1t < dist01){
            block.zMax1 = triangleZMax;
            block.coverageMask = triangleCoverageMask;
        } */
        block.zMax1 = Math.min(block.zMax1, triangleZMax);
        block.coverageMask |= triangleCoverageMask;

        if (false && block.coverageMask === fullyCoveredBlock) {
            block.zMax0 = block.zMax1;
            block.zMax1 = 0;
            block.coverageMask = 0;
        }
    }

    function ndcTo01(out, point) {
        out.x = (point.x + 1) * 0.5;
        out.y = (point.y + 1) * 0.5;
        out.z = (point.z + 1) * 0.5;
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

    function getLineMask(ax, ay, bx, by, cx, cy, x, y, x0) {
        // Calculate intersection with the x axis
        // y = k * x + m
        // x = (y - m) / k
        // k = (y - m) / x
        // m = y - k * x
        var xpixels = Math.max(0, Math.floor((x0 - x) * w + 0.5 + (ay < by ? -.5 : .5)));
        var mask = 0;
        if (xpixels >= 1 && xpixels <= blockSizeX) {
            mask = ~((~0) >>> (-xpixels));
        } else if (xpixels <= 0) {
            mask = ~0;
        } else if (xpixels > blockSizeX) {
            mask = 0;
        }
        if (ay <= by) mask = ~mask;
        //if((bx-ax)*(cy-ay) - (by-ay)*(cx-ax) > 0) mask = ~mask; // fix for back faces?
        return mask;
    }

})(window);