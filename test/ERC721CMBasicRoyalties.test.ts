import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'hardhat';
import { ERC721CMBasicRoyalties } from '../typechain-types';

chai.use(chaiAsPromised);

describe('ERC721CMBasicRoyalties', function () {
  let contract: ERC721CMBasicRoyalties;
  let owner: SignerWithAddress;

  beforeEach(async () => {
    const ERC721CMBasicRoyalties = await ethers.getContractFactory('ERC721CMBasicRoyalties');
    const erc721cmBasicRoyalties = await ERC721CMBasicRoyalties.deploy(
      'Test',
      'TEST',
      '',
      1000,
      0,
      ethers.constants.AddressZero,
      60,
      ethers.constants.AddressZero,
      '0x0764844ac95ABCa4F6306E592c7D9C9f3615f590', // erc2198royaltyreceiver
      10, // erc2198royaltyfeenumerator
    );
    await erc721cmBasicRoyalties.deployed();

    [owner] = await ethers.getSigners();
    contract = erc721cmBasicRoyalties.connect(owner);
  });

  it('Royalty info', async () => {
    let royaltyInfo = await contract.royaltyInfo(0, 1000);
    expect(royaltyInfo[0]).to.equal('0x0764844ac95ABCa4F6306E592c7D9C9f3615f590');
    expect(royaltyInfo[1].toNumber()).to.equal(1);

    royaltyInfo = await contract.royaltyInfo(1, 9999);
    expect(royaltyInfo[0]).to.equal('0x0764844ac95ABCa4F6306E592c7D9C9f3615f590');
    expect(royaltyInfo[1].toNumber()).to.equal(9);

    royaltyInfo = await contract.royaltyInfo(1111, 9999999999);
    expect(royaltyInfo[0]).to.equal('0x0764844ac95ABCa4F6306E592c7D9C9f3615f590');
    expect(royaltyInfo[1].toNumber()).to.equal(9999999);
  });
});
