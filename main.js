var occlusionCulling;
var ctx, w, h, camera, renderer, scene;
var stats, data;
var demoCamera, demoRenderer, demoScene, cameraObject, controls, boxes=[], demoBoxes=[], sortedBoxes, tempBBox;
var parameters = {
  maxRenderedOccluders: 16,
  renderMipmaps: true,
  numBoxes: 30
};
var minBoxSize = 0.1;
var maxBoxSize = 1;
var va = new THREE.Vector4();
var vb = new THREE.Vector4();
var vc = new THREE.Vector4();
var mvpMatrix = new THREE.Matrix4();
var viewProjectionMatrix = new THREE.Matrix4();
var tempCorners = Array.from(new Array(8), function(){ return new THREE.Vector4(); });

init();
animate();

function init(){

  // Init rendering
  w = canvas.width;
  h = canvas.height;

  // For mips:
  ctx = canvas2.getContext('2d');
  data = ctx.createImageData(w*2,h);

  // Init stats
  stats = new Stats();
  document.body.appendChild( stats.dom );
  stats.dom.style.top = 2*h + 'px';

  occlusionCulling = new OcclusionCulling();
  occlusionCulling.setResolution(w,h);

  renderer = new THREE.WebGLRenderer();
  renderer.setPixelRatio( window.devicePixelRatio );
  renderer.setSize( 2*w, 2*h );
  renderer.setClearColor( 0x000000, 1 );
  document.getElementById('webglDebugContainer').appendChild( renderer.domElement );

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera( 45, 1/1, 2, 10 );
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
  demoCamera = new THREE.PerspectiveCamera( 45, window.innerWidth/window.innerHeight, 0.5, 200 );
  demoCamera.position.set(5,14,10);
  var helper = new THREE.CameraHelper( camera );
  demoScene.add( helper );
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

  tempBBox = new THREE.Box3();

  var gui = new dat.GUI();
  gui.add(parameters, 'maxRenderedOccluders', 0, 100);
  gui.add(parameters, 'renderMipmaps');
  gui.add(occlusionCulling, 'renderBackfaces');
  gui.add(parameters, 'numBoxes', 1,3000).onChange(function(newValue){
    setNumBoxes( Math.floor(newValue) );
  });

  setNumBoxes(parameters.numBoxes);
}

function setNumBoxes(num){
  sortedBoxes = null;

  // Add new boxes
  while(demoBoxes.length < num){
    var size = minBoxSize + Math.random() * (maxBoxSize-minBoxSize);
    var occluderScale = 0.9; // Make occluders slightly smaller than the rendered meshes.

    // Create occlusion culling box
    var box = new THREE.Mesh(new THREE.BoxBufferGeometry(occluderScale*size,occluderScale*size,occluderScale*size), new THREE.MeshDepthMaterial()); box.position.set(Math.random()-0.5,0,Math.random()-0.5).multiplyScalar(5);
    box.position.z-=5;
    scene.add(box);
    boxes.push(box);

    // Create demo box (visual)
    var demoBox = new THREE.Mesh(new THREE.BoxBufferGeometry(size,size,size), new THREE.MeshLambertMaterial({ color: 0xff0000 }));
    demoBox.position.copy(box.position);
    demoScene.add(demoBox);
    demoBoxes.push(demoBox);

    demoBox.frustumCulled = box.frustumCulled = false;

    // Pre-compute the approx size
    box.geometry.computeBoundingSphere();
    demoBox.geometry.computeBoundingBox();
  }

  // Remove unused
  while(demoBoxes.length > num){
    demoScene.remove(demoBoxes.pop());
    scene.remove(boxes.pop());
  }
}

function animate(time){
  stats.begin();
  occlusionCulling.clear();
  updateZPyramid();
  cullObjects();
  render(time);
  stats.end();
  requestAnimationFrame(animate);
}

function cullObjects(){
  viewProjectionMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
  var numVisible = 0;
  for(var i=0; i<boxes.length; i++){
       boxes[i].visible = demoBoxes[i].visible = !objectIsOccluded(demoBoxes[i]);
      if(boxes[i].visible) numVisible++;
  }
}

function objectIsOccluded(object){
  mvpMatrix.multiplyMatrices(viewProjectionMatrix, object.matrixWorld);

  // Compute the bounding rectangle in screen space by using the bounding box.
  var l = object.geometry.boundingBox.min;
  var u = object.geometry.boundingBox.max;
  tempCorners[0].copy(l);
	tempCorners[1].set( u.x, l.y, l.z );
	tempCorners[2].set( l.x, u.y, l.z );
	tempCorners[3].set( u.x, u.y, l.z );
	tempCorners[4].set( l.x, l.y, u.z );
	tempCorners[5].set( u.x, l.y, u.z );
	tempCorners[6].set( l.x, u.y, u.z );
  tempCorners[7].copy(u);
  for(var i=0; i<tempCorners.length; i++){
    var v = tempCorners[i];
    v.w = 1;
    v.applyMatrix4( mvpMatrix );
    v.divideScalar(v.w);
  }
  var ndcRectX0 = Math.min(tempCorners[0].x, tempCorners[1].x, tempCorners[2].x, tempCorners[3].x, tempCorners[4].x, tempCorners[5].x, tempCorners[6].x, tempCorners[7].x);
  var ndcRectX1 = Math.max(tempCorners[0].x, tempCorners[1].x, tempCorners[2].x, tempCorners[3].x, tempCorners[4].x, tempCorners[5].x, tempCorners[6].x, tempCorners[7].x);
  var ndcRectY0 = Math.min(tempCorners[0].y, tempCorners[1].y, tempCorners[2].y, tempCorners[3].y, tempCorners[4].y, tempCorners[5].y, tempCorners[6].y, tempCorners[7].y);
  var ndcRectY1 = Math.max(tempCorners[0].y, tempCorners[1].y, tempCorners[2].y, tempCorners[3].y, tempCorners[4].y, tempCorners[5].y, tempCorners[6].y, tempCorners[7].y);

  // Is the rect inside the unit box?
  if(ndcRectX1 < -1 || ndcRectY1 < -1 || ndcRectX0 > 1 || ndcRectX0 > 1) return false;

  // Find closest AABB depth value
  var boundingRectDepth = Math.min(tempCorners[0].z, tempCorners[1].z, tempCorners[2].z, tempCorners[3].z, tempCorners[4].z, tempCorners[5].z, tempCorners[6].z, tempCorners[7].z);

  return occlusionCulling.ndcRectIsOccluded(ndcRectX0,ndcRectX1,ndcRectY0,ndcRectY1,boundingRectDepth);
}

function insertionSort(a, getSortValue){
  for(var i=1,l=a.length; i<l; i++) {
      var v = a[i];
      for(var j=i - 1;j>=0;j--) {
          if(getSortValue(a[j]) <= getSortValue(v)){
              break;
          }
          a[j+1] = a[j];
      }
      a[j+1] = v;
  }
  return a;
}

function getSortValue(object){
  return object.position.distanceTo(cameraObject.position) / object.geometry.boundingSphere.radius;
}

function updateZPyramid(){
  viewProjectionMatrix.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );

  if(!sortedBoxes) sortedBoxes = boxes.slice(0);
  insertionSort(sortedBoxes, getSortValue).slice(0,parameters.maxRenderedOccluders).forEach((box) => {
    mvpMatrix.multiplyMatrices(viewProjectionMatrix, box.matrixWorld);

    var indices = box.geometry.index.array;
    var vertices = box.geometry.attributes.position.array;
    occlusionCulling.renderTriangles( indices, vertices, mvpMatrix.elements );
  });
}

function render(time){
  controls.update();

	renderer.render( scene, camera );

  camera.position.copy( cameraObject.position );
	demoRenderer.render( demoScene, demoCamera );

  if(parameters.renderMipmaps){
    occlusionCulling.renderToImageDataArray(data.data);
    ctx.putImageData(data,0,0);
  }
}