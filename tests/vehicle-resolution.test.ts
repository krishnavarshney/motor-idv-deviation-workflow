import{strict as assert}from"node:assert";import{resolveVehicle}from"../src/domain/vehicle-resolution";
const candidates=[{key:"1",make:"Maruti Suzuki",model:"Baleno",variant:"Zeta AMT",fuel:"Petrol",cc:1197},{key:"2",make:"Hyundai",model:"i20",variant:"Sportz",fuel:"Petrol",cc:1197}];
const exact=resolveVehicle({make:"Maruti-Suzuki",model:"Baleno",variant:"Zeta AMT",fuel:"Petrol",cc:1197},candidates);
assert.equal(exact?.strategy,"deterministic");assert.equal(exact?.candidate.key,"1");
const fuzzy=resolveVehicle({make:"Hyundai",model:"i20",variant:"Sportz",fuel:"Petrol"},candidates);
assert.equal(fuzzy?.candidate.key,"2");console.log("vehicle-resolution tests passed");