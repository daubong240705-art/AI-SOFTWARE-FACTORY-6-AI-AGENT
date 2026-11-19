import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { detailedToys, lightToys, toyInk, toyGlowInk, toyOutlineInk, warmWhipMaterials } from './models';
import { particleGeometry, lightParticleGeometry, particleMaterial, lightningGeometry, lightningMaterial, prepareParticleAtlas } from './particles';
/** Compile every toy/effect program before the first interaction, without drawing hidden tools. */
export function ToyPrewarm() {
  const { gl, camera, scene } = useThree();
  useEffect(() => {
    prepareParticleAtlas();
    const warm = new THREE.Scene();
    for (const models of [detailedToys, lightToys]) for (const model of Object.values(models)) {
      warm.add(new THREE.Mesh(model.solid, toyInk), new THREE.Mesh(model.hull, toyOutlineInk));
      if (model.glow) warm.add(new THREE.Mesh(model.glow, toyGlowInk));
    }
    warm.add(new THREE.Mesh(detailedToys.whip.solid, warmWhipMaterials.solid), new THREE.Mesh(detailedToys.whip.hull, warmWhipMaterials.outline));
    warm.add(new THREE.Mesh(particleGeometry, particleMaterial), new THREE.Mesh(lightParticleGeometry, particleMaterial), new THREE.Mesh(lightningGeometry, lightningMaterial));
    // Use the actual scene's lights so toon programs match those used at runtime.
    gl.compile(warm, camera, scene);
    gl.compile(scene, camera);
    warm.clear();
  }, [gl, camera, scene]);
  return null;
}
