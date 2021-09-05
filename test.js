let stri = "da2kr32a2"
const patt = /(.{2,}).*(?:\1)+/i
if(stri.match(patt) === null){
    console.log(`no`)
}
else{
    console.log(`yes ${stri.match(patt)[1]}`)
}

