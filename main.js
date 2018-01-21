var blocks, ctx, w, h, numBlocksX, numBlocksY, blockSizeX, blockSizeY, fullyCoveredBlock, mipmaps, camera, renderer, scene;
var data;
var demoCamera, demoRenderer, demoScene, cameraObject, controls, boxes=[], demoBoxes=[];
var numBoxes = 20;

var va = new THREE.Vector4();
var vb = new THREE.Vector4();
var vc = new THREE.Vector4();
var mvpMatrix = new THREE.Matrix4();
var viewMatrix = new THREE.Matrix4();
var viewProjectionMatrix = new THREE.Matrix4();

function Block(){
  this.coverageMask = 1;
  this.zMax1 = 0;
  this.zMax0 = 0;
}
Block.prototype = {
  clear: function(){
    this.coverageMask = 0;
    this.zMax0 = 1;
    this.zMax1 = 0;
  }
};

init();
animate();

function init(){

  // Init rendering
  ctx = canvas.getContext('2d');
  w = canvas.width;
  h = canvas.height;
  data = ctx.createImageData(w,h);
  // For mips:
  ctx2 = canvas2.getContext('2d');
  data2 = ctx2.createImageData(w*2,h);

  // Init blocks
  blockSizeX = 1;
  blockSizeY = 1;
  fullyCoveredBlock = (~0)>>>(32-blockSizeX);
  blocks = [];
  numBlocksX = Math.ceil(w / blockSizeX);
  numBlocksY = Math.ceil(h / blockSizeY);
  for(var j=0; j<numBlocksY*numBlocksX; j++){
      blocks.push(new Block());
  }

  // Init mipmaps
  mipmaps = [];
  var mipSize = w;
  while(mipSize > 2){
    mipmaps.push(new Float32Array(mipSize*mipSize));
    mipSize /= 2;
  }

  renderer = new THREE.WebGLRenderer();
  renderer.setPixelRatio( window.devicePixelRatio );
  renderer.setSize( w, h );
  renderer.setClearColor( 0x000000, 1 );
  document.getElementById('webglDebugContainer').appendChild( renderer.domElement );

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera( 45, 1/1, 0.5, 4 );
  camera.position.z = 2;

  // Init demo
  demoRenderer = new THREE.WebGLRenderer();
  demoRenderer.setPixelRatio( window.devicePixelRatio );
  demoRenderer.setSize( window.innerWidth, window.innerHeight );
  demoRenderer.setClearColor( 0x000000, 1 );
  document.getElementById('demoContainer').appendChild( demoRenderer.domElement );
  demoScene = new THREE.Scene();
	demoScene.background = new THREE.Color( 0xf0f0f0 );
  var light = new THREE.DirectionalLight( 0xffffff, 1 );
  light.position.set( 1, 0.5, 2 ).normalize();
  demoScene.add( light );
  demoCamera = new THREE.PerspectiveCamera( 45, window.innerWidth/window.innerHeight, 0.1, 100 );
  demoCamera.position.set(5,14,10);
  cameraObject = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshLambertMaterial());
  demoScene.add(cameraObject);
	demoCamera.lookAt( new THREE.Vector3( 0, 0, 0 ) );

  controls = new THREE.TransformControls(demoCamera, demoRenderer.domElement);
  controls.attach(cameraObject);
  controls.addEventListener( 'change', function(){} );
  demoScene.add(controls);
	window.addEventListener( 'resize', function() {
    demoCamera.aspect = window.innerWidth / window.innerHeight;
    demoCamera.updateProjectionMatrix();
    demoRenderer.setSize( window.innerWidth, window.innerHeight );
  }, false );


  for(var i=0; i<numBoxes; i++){
    var size = Math.random() * 1;

    // Create occlusion culling box
    var box = new THREE.Mesh(new THREE.BoxGeometry(size,size,size), new THREE.MeshDepthMaterial()); box.position.set(Math.random()-0.5,0,Math.random()-0.5).multiplyScalar(5);
    box.position.z-=4;
    box.position.y=Math.random()-0.5;
    scene.add(box);
    boxes.push(box);

    // Create demo box (visual)
    var demoBox = new THREE.Mesh(new THREE.BoxGeometry(size,size,size), new THREE.MeshLambertMaterial({ color: 0xff0000 })); demoBox.position.copy(box.position);
    demoScene.add(demoBox);
    demoBoxes.push(demoBox);
  }
}

function animate(time){
  requestAnimationFrame(animate);
  clearZPyramid();
  updateZPyramid();
  cullObjects();
  render(time);
}

function cullObjects(){
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  viewMatrix.copy( camera.matrixWorldInverse );
  viewProjectionMatrix.multiplyMatrices( camera.projectionMatrix, viewMatrix );
  boxes.forEach((box, boxIndex) => {
    box.visible = demoBoxes[boxIndex].visible = !objectIsOccluded(box);
  });
}

function objectIsOccluded(object){
  mvpMatrix.multiplyMatrices(viewProjectionMatrix, object.matrixWorld);
  for(var i=0; i<object.geometry.faces.length; i++){
    var face = object.geometry.faces[i];
    va.copy(object.geometry.vertices[face.a]);
    vb.copy(object.geometry.vertices[face.b]);
    vc.copy(object.geometry.vertices[face.c]);
    va.w = vb.w = vc.w = 1;
    va.applyMatrix4( mvpMatrix );
    vb.applyMatrix4( mvpMatrix );
    vc.applyMatrix4( mvpMatrix );
    va.divideScalar(va.w);
    vb.divideScalar(vb.w);
    vc.divideScalar(vc.w);

    // Cull in screen space
    if(!triangleIsOccluded(va,vb,vc)){
      return false;
    }
  }
  return true;
}

function triangleIsOccluded(va,vb,vc){
  var triangleMax = Math.min(va.z,vb.z,vc.z);

  // Convert to screen space (0 to 1)
  va.x = (va.x+1)*0.5;
  va.y = (va.y+1)*0.5;

  vb.x = (vb.x+1)*0.5;
  vb.y = (vb.y+1)*0.5;

  vc.x = (vc.x+1)*0.5;
  vc.y = (vc.y+1)*0.5;

  var i=mipmaps.length-1; //for(var i=0; i<mipmaps.length - 1; i++)
  {
    var mipmap = mipmaps[mipmaps.length-1-i];
    var mipMapSize = Math.sqrt( mipmap.length ); // assume square

    var ax = Math.floor( va.x * mipMapSize );
    var ay = Math.floor( va.y * mipMapSize );
    var bx = Math.floor( vb.x * mipMapSize );
    var by = Math.floor( vb.y * mipMapSize );
    var cx = Math.floor( vc.x * mipMapSize );
    var cy = Math.floor( vc.y * mipMapSize );

    // Get xy bounds for triangle
    var minx = Math.min(ax,bx,cx);
    var maxx = Math.max(ax,bx,cx);
    var miny = Math.min(ay,by,cy);
    var maxy = Math.max(ay,by,cy);
    minx = clamp(minx, 0, mipMapSize);
    maxx = clamp(maxx, 0, mipMapSize);
    miny = clamp(miny, 0, mipMapSize);
    maxy = clamp(maxy, 0, mipMapSize);

    for(var x=minx; x<maxx; x++){
      for(var y=miny; y<maxy; y++){
        var depth = mipmap[y*mipMapSize+x];
        if(triangleMax < depth){
           return false;
        }
      }
    }
  }

  return true;
}

function checkBackfaceCulling( v1, v2, v3 ) {
  return ( ( v3.x - v1.x ) * ( v2.y - v1.y ) - ( v3.y - v1.y ) * ( v2.x - v1.x ) ) < 0;
}
function clamp(x,min,max){ return Math.min(Math.max(x,min),max); }
function clearZPyramid(){
  blocks.forEach((b) => {
    b.clear();
  });
}
function updateZPyramid(){
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  viewMatrix.copy( camera.matrixWorldInverse );
  viewProjectionMatrix.multiplyMatrices( camera.projectionMatrix, viewMatrix );

  boxes.forEach((box) => {
    mvpMatrix.multiplyMatrices(viewProjectionMatrix, box.matrixWorld);
    box.geometry.faces.forEach((face,faceIndex) => {
      va.copy(box.geometry.vertices[face.a]);
      vb.copy(box.geometry.vertices[face.b]);
      vc.copy(box.geometry.vertices[face.c]);
      va.w = vb.w = vc.w = 1;
      va.applyMatrix4( mvpMatrix );
      vb.applyMatrix4( mvpMatrix );
      vc.applyMatrix4( mvpMatrix );
      va.divideScalar(va.w);
      vb.divideScalar(vb.w);
      vc.divideScalar(vc.w);

      drawTriangleToZPyramid(va,vb,vc);
    });
  });
  updateMipMaps();
}

function updateMipMaps(){
  // Update first mipmap
  var mipSize = w;
  for(var py=0; py<mipSize; py++){
    for(var px=0; px<mipSize; px++){
      var mipPosition = py*mipSize + px;
      var blockX = Math.floor(px / blockSizeX);
      var blockY = Math.floor(py / blockSizeY);
      var block = blocks[blockY*numBlocksX + blockX];
      var pixelOffset = px-blockX*blockSizeX;
      var pixelBit = (1 << pixelOffset);
      var depth = (block.coverageMask & pixelBit) ? block.zMax1 : block.zMax0;
      mipmaps[0][mipPosition] = depth;
    }
  }

  // Update smaller mipmaps
  var mipSize = w / 2;
  var mipIndex = 1;
  while(mipSize>2){
    for(var py=0; py<mipSize; py++){
      for(var px=0; px<mipSize; px++){
        var mipPosition = py*mipSize + px;
        var depth0 = mipmaps[mipIndex-1][(2*py  ) * 2*mipSize + 2*px];
        var depth1 = mipmaps[mipIndex-1][(2*py+1) * 2*mipSize + 2*px];
        var depth2 = mipmaps[mipIndex-1][(2*py  ) * 2*mipSize + 2*px + 1];
        var depth3 = mipmaps[mipIndex-1][(2*py+1) * 2*mipSize + 2*px + 1];
        mipmaps[mipIndex][mipPosition] = Math.min(depth0,depth1,depth2,depth3);
      }
    }
    mipSize /= 2;
    mipIndex++;
  }
}

function updateHiZBuffer(block, triangleZMax, triangleCoverageMask){
    var dist1t = block.zMax1 - triangleZMax;
    var dist01 = block.zMax0 - block.zMax1;
    if(dist1t > dist01){
        block.zMax1 = triangleZMax;
        block.coverageMask = triangleCoverageMask;
    }
    block.zMax1 = Math.max(block.zMax1, triangleZMax);
    block.coverageMask |= triangleCoverageMask;

    if(false && block.coverageMask === fullyCoveredBlock){
        block.zMax0 = block.zMax1;
        block.zMax1 = 0;
        block.coverageMask = 0;
    }
}

function updateHiZBuffer2(block, triangleZMax, triangleCoverageMask){
    var dist1t = block.zMax1 - triangleZMax;
    var dist01 = block.zMax0 - block.zMax1;
    if(dist1t < dist01){ // TODO: I changed this to < instead of >, why?
        block.zMax1 = 0; // Why does this not work?
        block.coverageMask = 0;
    }
    block.zMax1 = Math.max(block.zMax1, triangleZMax);
    block.coverageMask |= triangleCoverageMask;

    if(block.coverageMask === fullyCoveredBlock){
        block.zMax0 = block.zMax1;
        block.zMax1 = 0;
        block.coverageMask = 0;
    }
}

function drawTriangleToZPyramid(va,vb,vc){
  if(!checkBackfaceCulling(va,vb,vc)){
    return; // backface culling
  }

  // Convert to screen space (0 to 1)
  va.x = (va.x+1)*0.5;
  va.y = (va.y+1)*0.5;

  vb.x = (vb.x+1)*0.5;
  vb.y = (vb.y+1)*0.5;

  vc.x = (vc.x+1)*0.5;
  vc.y = (vc.y+1)*0.5;

  var triangleZMax = Math.max(va.z, vb.z, vc.z);
  //if(isNaN(triangleZMax)) debugger;
  var ax = Math.floor( va.x * w );
  var ay = Math.floor( va.y * h );
  var bx = Math.floor( vb.x * w );
  var by = Math.floor( vb.y * h );
  var cx = Math.floor( vc.x * w );
  var cy = Math.floor( vc.y * h );
  // Get xy bounds for triangle
  var minx = Math.min(ax,bx,cx);
  var maxx = Math.max(ax,bx,cx);
  var miny = Math.min(ay,by,cy);
  var maxy = Math.max(ay,by,cy);
  minx = clamp(minx, 0, w);
  maxx = clamp(maxx, 0, w);
  miny = clamp(miny, 0, h);
  maxy = clamp(maxy, 0, h);
  var jmin = Math.floor(miny / blockSizeY);
  var jmax = Math.ceil(maxy / blockSizeY);
  var loops = 0;
  for(var j=jmin; j<jmax; j++){
    var y = blockSizeY*j / h;
    var xIntersect0 = getXAxisIntersection(va.x, va.y, vb.x, vb.y, y);
    var xIntersect1 = getXAxisIntersection(vb.x, vb.y, vc.x, vc.y, y);
    var xIntersect2 = getXAxisIntersection(vc.x, vc.y, va.x, va.y, y);

      loops++;
      if(loops > 128) debugger;
    var kmin = Math.floor(minx / blockSizeX);
    var kmax = Math.ceil(maxx/blockSizeX);
    for(var k=kmin; k<kmax; k++){
      var blockIndex = j*numBlocksX + k;
      var block = blocks[blockIndex];

      var x = blockSizeX*k / w;

      var mask0 = getLineMask(va.x, va.y, vb.x, vb.y, vc.x, vc.y, x, y, xIntersect0);
      var mask1 = getLineMask(vb.x, vb.y, vc.x, vc.y, va.x, va.y, x, y, xIntersect1);
      var mask2 = getLineMask(vc.x, vc.y, va.x, va.y, vb.x, vb.y, x, y, xIntersect2);

      var triangleCoverageMask = mask0 & mask1 & mask2;
      //if(triangleCoverageMask) debugger
      //if(triangleCoverageMask){
      updateHiZBuffer(block, triangleZMax, triangleCoverageMask);
      //}
    }
  }
}

function getXAxisIntersection(ax,ay,bx,by,y){
  var x0 = ax;
  if(bx != ax){
    var k0 = (by - ay) / (bx - ax);
    var m0 = ay - k0 * ax;
    x0 = (y - m0) / k0;
  }
  return x0;
}

function getLineMask(ax,ay,bx,by,cx,cy,x,y,x0){
  // Calculate intersection with the x axis
  // y = k * x + m
  // x = (y - m) / k
  // k = (y - m) / x
  // m = y - k * x
  var xpixels = Math.max(0, Math.floor( (x0-x) * w + 0.5 + (ay<by ? -.5 : .5)));
  var mask = 0;
  if(xpixels >= 1 && xpixels <= blockSizeX){
    mask = ~((~0) >>> (-xpixels));
  } else if(xpixels<=0){
    mask = ~0;
  } else if(xpixels>blockSizeX){
    mask = 0;
  }
  if(ay<=by) mask = ~mask;
  //if((bx-ax)*(cy-ay) - (by-ay)*(cx-ax) > 0) mask = ~mask; // fix for back faces?
  return mask;
}

function render(time){
  controls.update();
  var timeSeconds = time / 1000;

	renderer.render( scene, camera );

  camera.position.copy( cameraObject.position );
	demoRenderer.render( demoScene, demoCamera );

  ctx.fillRect(0,0,w,h);
  var blockIndex = 0;
  for(var i=0;i<data.data.length;i++) data.data[i] = 0; // clear
  for(var j=0; j<numBlocksY; j++){
    for(var i=0; i<numBlocksX; i++){
      renderBlockToCanvas(blocks[blockIndex++], blockSizeX*i, blockSizeY*j);
    }
  }
  ctx.putImageData(data,0,0);

  /*
  // Debug render the final triangle
  box2.geometry.faces.forEach((face,faceIndex) => {
    va.copy(box2.geometry.vertices[face.a]);
    vb.copy(box2.geometry.vertices[face.b]);
    vc.copy(box2.geometry.vertices[face.c]);
    va.w = vb.w = vc.w = 1;
    va.applyMatrix4( mvpMatrix );
    vb.applyMatrix4( mvpMatrix );
    vc.applyMatrix4( mvpMatrix );
    va.divideScalar(va.w);
    vb.divideScalar(vb.w);
    vc.divideScalar(vc.w);
    ctx.beginPath();
    ctx.moveTo(0.5*(va.x*w+w),0.5*(va.y*h+h));
    ctx.lineTo(0.5*(vb.x*w+w),0.5*(vb.y*h+h));
    ctx.lineTo(0.5*(vc.x*w+w),0.5*(vc.y*h+h));
    ctx.closePath();
    ctx.strokeStyle = 'red';
    ctx.stroke();
  });
  */

  // Render mips
  var mipSize = w;
  var mipIndex = 0;
  var dataX = 0;
  for(var i=0;i<data2.data.length;i++) data2.data[i] = 0; // clear
  while(mipSize>2){
    for(var py=0; py<mipSize; py++){
      for(var px=0; px<mipSize; px++){
        var mipPosition = py*mipSize + px;
        var depth = mipmaps[mipIndex][mipPosition];
        var dataOffset = 4*((mipSize-py-1)*w*2 + dataX+px); // render upside down
        data2.data[dataOffset+0] = 255*depth;
        data2.data[dataOffset+1] = 255*depth;
        data2.data[dataOffset+2] = 255*depth;
        data2.data[dataOffset+3] = 255;
      }
    }
    dataX += mipSize;
    mipSize /= 2;
    mipIndex++;
  }
  ctx2.putImageData(data2,0,0);
}

function renderBlockToCanvas(block,x,y){
  for(var i=0; i<blockSizeX; i++){
    //var c = Math.floor(block.zMax0 * 255); // (block.coverageMask & (1<<i)) ? 255 : 0;
    var c = Math.floor(255*((block.coverageMask & (1<<i)) ? block.zMax1 : block.zMax0));
    data.data[4 * (x+i+(y)*w) + 0] = c;
    data.data[4 * (x+i+(y)*w) + 1] = c;
    data.data[4 * (x+i+(y)*w) + 2] = c;
    data.data[4 * (x+i+(y)*w) + 3] = 255;
  }
}