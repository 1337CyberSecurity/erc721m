import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import chai, { assert, expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'hardhat';
import { MerkleTree } from 'merkletreejs';
import { ERC721M } from '../typechain-types';

const { keccak256, getAddress } = ethers.utils;

chai.use(chaiAsPromised);

describe('ERC721M', function () {
  let contract: ERC721M;
  let readonlyContract: ERC721M;
  let owner: SignerWithAddress;
  let readonly: SignerWithAddress;


  beforeEach(async () => {
    const ERC721M = await ethers.getContractFactory('ERC721M');
    const erc721M = await ERC721M.deploy('Test', 'TEST', '', 1000, 0);
    await erc721M.deployed();

    [owner, readonly] = await ethers.getSigners();
    contract = erc721M.connect(owner);
    readonlyContract = erc721M.connect(readonly);
  });

  it('Contract can be paused/unpaused', async () => {
    // starts paused
    expect(await contract.getMintable()).to.be.false;

    // unpause
    await contract.setMintable(true);
    expect(await contract.getMintable()).to.be.true;

    // we should assert that the correct event is emitted
    await expect(contract.setMintable(false)).to.emit(contract, 'SetMintable').withArgs(false);
    expect(await contract.getMintable()).to.be.false;

    // readonlyContract should not be able to setMintable
    await expect(readonlyContract.setMintable(true)).to.be.revertedWith('Ownable');
  });

  it('withdraws balance by owner', async () => {
    // Send 100 wei to contract address for testing.
    await ethers.provider.send('hardhat_setBalance', [
      contract.address,
      '0x64', // 100 wei
    ]);
    expect(
      (await contract.provider.getBalance(contract.address)).toNumber(),
    ).to.equal(100);

    await contract.withdraw();

    // TODO: fix the 'Provider not found' error here
    // await expect(contract.withdraw()).to.changeEtherBalance(owner.address, 100);

    expect(
      (await contract.provider.getBalance(contract.address)).toNumber(),
    ).to.equal(0);

    // readonlyContract should not be able to withdraw
    await expect(readonlyContract.withdraw()).to.be.revertedWith('Ownable');
  });

  describe('Stages', function () {
    it('cannot set stages with readonly address', async () => {
      expect(readonlyContract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [3, 4],
        [
          ethers.utils.hexZeroPad('0x1', 32),
          ethers.utils.hexZeroPad('0x2', 32),
        ],
        [5, 10],
      )).to.be.revertedWith('Ownable');
    });

    it('can set / reset stages', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [3, 4],
        [
          ethers.utils.hexZeroPad('0x1', 32),
          ethers.utils.hexZeroPad('0x2', 32),
        ],
        [5, 10],
      );

      expect(await contract.getNumberStages()).to.equal(2);

      let [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.5'));
      expect(stageInfo.walletLimit).to.equal(3);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(5);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x1', 32));
      expect(walletMintedCount).to.equal(0);

      [stageInfo, walletMintedCount] = await contract.getStageInfo(1);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.6'));
      expect(stageInfo.walletLimit).to.equal(4);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(10);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x2', 32));
      expect(walletMintedCount).to.equal(0);

      // Update to one stage
      await contract.setStages(
        [ethers.utils.parseEther('0.6')],
        [4],
        [ethers.utils.hexZeroPad('0x3', 32)],
        [0],
      );

      expect(await contract.getNumberStages()).to.equal(1);
      [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.6'));
      expect(stageInfo.walletLimit).to.equal(4);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(0);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x3', 32));
      expect(walletMintedCount).to.equal(0);

      // Add another stage
      await contract.setStages(
        [ethers.utils.parseEther('0.6'), ethers.utils.parseEther('0.7')],
        [4, 5],
        [
          ethers.utils.hexZeroPad('0x4', 32),
          ethers.utils.hexZeroPad('0x4', 32),
        ],
        [0, 5],
      );
      expect(await contract.getNumberStages()).to.equal(2);
      [stageInfo, walletMintedCount] = await contract.getStageInfo(1);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.7'));
      expect(stageInfo.walletLimit).to.equal(5);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(5);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x4', 32));
      expect(walletMintedCount).to.equal(0);
    });

    it('sets stages reverts for invalid input', async () => {
      let setStages = contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [3, 4],
        [
          ethers.utils.hexZeroPad('0x1', 32),
          ethers.utils.hexZeroPad('0x2', 32),
        ],
        [5], // Missing maxStageSupplies for the second stage
      );

      await expect(setStages).to.be.revertedWith('InvalidStageArgsLength');

      setStages = contract.setStages(
        [ethers.utils.parseEther('0.6')],
        [3, 4],
        [
          ethers.utils.hexZeroPad('0x1', 32),
          ethers.utils.hexZeroPad('0x2', 32),
        ],
        [0, 5], // Missing maxStageSupplies for the second stage
      );

      await expect(setStages).to.be.revertedWith('InvalidStageArgsLength');

      setStages = contract.setStages(
        [ethers.utils.parseEther('0.6'), ethers.utils.parseEther('0.6')],
        [3, 4],
        [
          ethers.utils.hexZeroPad('0x1', 32),
        ],
        [0, 5], // Missing maxStageSupplies for the second stage
      );

      await expect(setStages).to.be.revertedWith('InvalidStageArgsLength');
    });

    it('can update stage', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [3, 4],
        [
          ethers.utils.hexZeroPad('0x1', 32),
          ethers.utils.hexZeroPad('0x2', 32),
        ],
        [5, 10],
      );

      expect(await contract.getNumberStages()).to.equal(2);

      let [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.5'));
      expect(stageInfo.walletLimit).to.equal(3);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(5);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x1', 32));
      expect(walletMintedCount).to.equal(0);

      [stageInfo, walletMintedCount] = await contract.getStageInfo(1);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.6'));
      expect(stageInfo.walletLimit).to.equal(4);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(10);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x2', 32));
      expect(walletMintedCount).to.equal(0);

      // Update first stage
      await expect(contract.updateStage(
        /* _index= */ 0,
        /* price= */ ethers.utils.parseEther('0.1'),
        /* walletLimit= */ 13,
        /* merkleRoot= */ ethers.utils.hexZeroPad('0x9', 32),
        /* maxStageSupply= */ 15,
      )).to.emit(contract, 'UpdateStage').withArgs(
        0,
        ethers.utils.parseEther('0.1'),
        13,
        ethers.utils.hexZeroPad('0x9', 32),
        15,
      );

      expect(await contract.getNumberStages()).to.equal(2);

      [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.1'));
      expect(stageInfo.walletLimit).to.equal(13);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(15);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x9', 32));
      expect(walletMintedCount).to.equal(0);

      // Stage 2 is unchanged.
      [stageInfo, walletMintedCount] = await contract.getStageInfo(1);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.6'));
      expect(stageInfo.walletLimit).to.equal(4);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(10);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x2', 32));
      expect(walletMintedCount).to.equal(0);
    });

    it('updates stage reverts for non-existent stage', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [3, 4],
        [
          ethers.utils.hexZeroPad('0x1', 32),
          ethers.utils.hexZeroPad('0x2', 32),
        ],
        [5, 10],
      );

      // Update a stage which doesn't exist.
      const updateStage = contract.updateStage(
        /* _index= */ 2,
        /* price= */ ethers.utils.parseEther('0.1'),
        /* walletLimit= */ 13,
        /* merkleRoot= */ ethers.utils.hexZeroPad('0x9', 32),
        /* maxStageSupply= */ 15,
      );

      await expect(updateStage).to.be.revertedWith('InvalidStage');
    });

    it('gets stage info', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [3],
        [ethers.utils.hexZeroPad('0x1', 32)],
        [5],
      );

      expect(await contract.getNumberStages()).to.equal(1);

      const [stageInfo, walletMintedCount] = await contract.getStageInfo(0);
      expect(stageInfo.price).to.equal(ethers.utils.parseEther('0.5'));
      expect(stageInfo.walletLimit).to.equal(3);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(5);
      expect(stageInfo.merkleRoot).to.equal(ethers.utils.hexZeroPad('0x1', 32));
      expect(walletMintedCount).to.equal(0);
    });

    it('gets stage info reverts for non-existent stage', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [3],
        [ethers.utils.hexZeroPad('0x1', 32)],
        [5],
      );

      const getStageInfo = readonlyContract.getStageInfo(1);
      await expect(getStageInfo).to.be.revertedWith('InvalidStage');
    });

    it('can set active stage', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [3, 4],
        [
          ethers.utils.hexZeroPad('0x1', 32),
          ethers.utils.hexZeroPad('0x2', 32),
        ],
        [5, 10],
      );

      expect(await contract.getNumberStages()).to.equal(2);
      expect(await contract.getActiveStage()).to.equal(0);

      await contract.setActiveStage(1);
      expect(await contract.getActiveStage()).to.equal(1);

      const setActiveStage = contract.setActiveStage(2);
      await expect(setActiveStage).to.be.revertedWith('InvalidStage');

      // readonlyContract should not be able to set active stage
      await expect(readonlyContract.setActiveStage(2)).to.be.revertedWith('Ownable');
    });
  });

  describe('Minting', function () {
    it('revert if contract is not mintable', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [10],
        [ethers.utils.hexZeroPad('0x', 32)],
        [5],
      );

      // not mintable by owner
      let mint = contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.5'),
      });
      await expect(mint).to.be.revertedWith('NotMintable');

      // not mintable by readonly address
      mint = readonlyContract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.5'),
      });
      await expect(mint).to.be.revertedWith('NotMintable');
    });

    it('revert if contract without stages', async () => {
      await contract.setMintable(true);
      const mint = contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.5'),
      });

      await expect(mint).to.be.revertedWith('InvalidStage');
    });

    it('revert if incorrect (less) amount sent', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [10],
        [ethers.utils.hexZeroPad('0x', 32)],
        [5],
      );
      await contract.setMintable(true);

      let mint;
      mint = contract.mint(5, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('2.499'),
      });
      await expect(mint).to.be.revertedWith('NotEnoughValue');

      mint = contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.499999'),
      });
      await expect(mint).to.be.revertedWith('NotEnoughValue');
    });

    it('can set max mintable supply', async () => {
      await contract.setMaxMintableSupply(99);
      expect(await contract.getMaxMintableSupply()).to.equal(99);

      // can set the mintable supply again with the same value
      await contract.setMaxMintableSupply(99);
      expect(await contract.getMaxMintableSupply()).to.equal(99);

      // can set the mintable supply again with the lower value
      await contract.setMaxMintableSupply(98);
      expect(await contract.getMaxMintableSupply()).to.equal(98);

      // can not set the mintable supply with higher value
      await expect(contract.setMaxMintableSupply(100)).to.be.rejectedWith('CannotIncreaseMaxMintableSupply');

      // readonlyContract should not be able to set max mintable supply
      await expect(readonlyContract.setMaxMintableSupply(99)).to.be.revertedWith('Ownable');
    });

    it('enforces max mintable supply', async () => {
      await contract.setMaxMintableSupply(99);
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [10, 10],
        [ethers.utils.hexZeroPad('0x', 32), ethers.utils.hexZeroPad('0x', 32)],
        [5, 10],
      );
      await contract.setMintable(true);

      // Mint 100 tokens (1 over MaxMintableSupply)
      const mint = contract.mint(100, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('2.5'),
      });
      await expect(mint).to.be.revertedWith('NoSupplyLeft');
    });

    it('mint with unlimited stage limit', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [100],
        [ethers.utils.hexZeroPad('0x', 32)],
        [0],
      );
      await contract.setMaxMintableSupply(999);
      await contract.setMintable(true);

      // Mint 100 tokens - wallet limit
      await contract.mint(100, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('50'),
      });

      // Mint one more should fail
      const mint = contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.5'),
      });

      await expect(mint).to.be.revertedWith('WalletStageLimitExceeded');
    });

    it('mint with unlimited wallet limit', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [0],
        [ethers.utils.hexZeroPad('0x', 32)],
        [100],
      );
      await contract.setMaxMintableSupply(999);
      await contract.setMintable(true);

      // Mint 100 tokens - stage limit
      await contract.mint(100, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('50'),
      });

      // Mint one more should fail
      const mint = contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.5'),
      });

      await expect(mint).to.be.revertedWith('StageSupplyExceeded');
    });

    it('mint with free stage', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0')],
        [0],
        [ethers.utils.hexZeroPad('0x', 32)],
        [100],
      );
      await contract.setMintable(true);

      // Mint 100 tokens - stage limit
      await readonlyContract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0'),
      });
      const [stageInfo, walletMintedCount, stagedMintedCount] =
        await readonlyContract.getStageInfo(0);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(100);
      expect(walletMintedCount).to.equal(1);
      expect(stagedMintedCount.toNumber()).to.equal(1);
    });

    it('enforces stage supply', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [10, 10],
        [ethers.utils.hexZeroPad('0x', 32), ethers.utils.hexZeroPad('0x', 32)],
        [5, 10],
      );
      await contract.setMintable(true);

      // Mint 5 tokens
      await expect(contract.mint(5, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('2.5'),
      })).to.emit(contract, 'Transfer');

      let [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(0);

      expect(stageInfo.maxStageSupply.toNumber()).to.equal(5);
      expect(walletMintedCount).to.equal(5);
      expect(stagedMintedCount.toNumber()).to.equal(5);

      // Mint another 1 should fail since the stage limit has been reached.
      let mint = contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.5'),
      });
      await expect(mint).to.be.revertedWith('StageSupplyExceeded');

      // Mint another 5 should fail since the stage limit has been reached.
      mint = contract.mint(5, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('2.5'),
      });
      await expect(mint).to.be.revertedWith('StageSupplyExceeded');

      await contract.setActiveStage(1);

      await contract.mint(8, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('4.8'),
      });
      [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(1);
      expect(stageInfo.maxStageSupply.toNumber()).to.equal(10);
      expect(walletMintedCount).to.equal(8);
      expect(stagedMintedCount.toNumber()).to.equal(8);

      await assert.isRejected(
        contract.mint(3, [ethers.utils.hexZeroPad('0x', 32)], {
          value: ethers.utils.parseEther('1.8'),
        }),
        /StageSupplyExceeded/,
        "Minting more than the stage's supply should fail",
      );

      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('1.2'),
      });

      [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(1);
      expect(walletMintedCount).to.equal(10);
      expect(stagedMintedCount.toNumber()).to.equal(10);

      [stageInfo, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(0);
      expect(walletMintedCount).to.equal(5);
      expect(stagedMintedCount.toNumber()).to.equal(5);

      const [address] = await ethers.getSigners();
      const totalMinted = await contract.totalMintedByAddress(
        await address.getAddress(),
      );
      expect(totalMinted.toNumber()).to.equal(15);
    });

    it('enforces Merkle proof if required', async () => {
      const accounts = (await ethers.getSigners()).map((signer) =>
        getAddress(signer.address),
      );
      const signerAddress = await ethers.provider.getSigner().getAddress();

      const merkleTree = new MerkleTree(accounts, keccak256, {
        sortPairs: true,
        hashLeaves: true,
      });
      const root = merkleTree.getHexRoot();
      const proof = merkleTree.getHexProof(keccak256(signerAddress));

      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [10],
        [root],
        [5],
      );
      await contract.setMintable(true);

      // Mint 1 token with valid proof
      await contract.mint(1, proof, {
        value: ethers.utils.parseEther('0.5'),
      });
      const totalMinted = await contract.totalMintedByAddress(signerAddress);
      expect(totalMinted.toNumber()).to.equal(1);

      // Mint 1 token with someone's else proof should be reverted
      await expect(readonlyContract.mint(1, proof, {
        value: ethers.utils.parseEther('0.5'),
      })).to.be.rejectedWith('InvalidProof');
    });

    it('reverts on invalid Merkle proof', async () => {
      const root = ethers.utils.hexZeroPad('0x1', 32);
      const proof = [ethers.utils.hexZeroPad('0x1', 32)];
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [10],
        [root],
        [5],
      );
      await contract.setMintable(true);

      // Mint 1 token with invalid proof
      const mint = contract.mint(1, proof, {
        value: ethers.utils.parseEther('0.5'),
      });
      await expect(mint).to.be.revertedWith('InvalidProof');
    });

    it('mints by owner', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [1],
        [ethers.utils.hexZeroPad('0x', 32)],
        [1],
      );
      await contract.setMintable(true);

      const [owner, address1] = await ethers.getSigners();

      await contract.ownerMint(5, owner.address);

      const [, walletMintedCount, stagedMintedCount] =
        await contract.getStageInfo(0);
      expect(walletMintedCount).to.equal(0);
      expect(stagedMintedCount.toNumber()).to.equal(0);
      const ownerBalance = await contract.balanceOf(owner.address);
      expect(ownerBalance.toNumber()).to.equal(5);

      await contract.ownerMint(5, address1.address);
      const [, address1Minted] = await readonlyContract.getStageInfo(0, {
        from: address1.address,
      });
      expect(address1Minted).to.equal(0);

      const address1Balance = await contract.balanceOf(address1.address);
      expect(address1Balance.toNumber()).to.equal(5);

      expect((await contract.totalSupply()).toNumber()).to.equal(10);
    });

    it('mints by owner - invalid cases', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5')],
        [1],
        [ethers.utils.hexZeroPad('0x', 32)],
        [1],
      );
      await contract.setMintable(true);
      await expect(contract.ownerMint(1001, readonly.address)).to.be.revertedWith('NoSupplyLeft');
    });
  });

  describe('Token URI', function () {
    it('Reverts for nonexistent token', async () => {
      await expect(contract.tokenURI(0)).to.be.revertedWith(
        'URIQueryForNonexistentToken',
      );
    });

    it('Returns empty tokenURI on empty baseURI', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [10, 10],
        [ethers.utils.hexZeroPad('0x', 32), ethers.utils.hexZeroPad('0x', 32)],
        [5, 10],
      );
      await contract.setMintable(true);

      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('2.5'),
      });

      expect(await contract.tokenURI(0)).to.equal('');
      expect(await contract.tokenURI(1)).to.equal('');

      await expect(contract.tokenURI(2)).to.be.revertedWith(
        'URIQueryForNonexistentToken',
      );
    });

    it('Returns non-empty tokenURI on non-empty baseURI', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [10, 10],
        [ethers.utils.hexZeroPad('0x', 32), ethers.utils.hexZeroPad('0x', 32)],
        [5, 10],
      );

      await contract.setBaseURI('base_uri_');
      await contract.setMintable(true);

      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('2.5'),
      });

      expect(await contract.tokenURI(0)).to.equal('base_uri_0');
      expect(await contract.tokenURI(1)).to.equal('base_uri_1');

      await expect(contract.tokenURI(2)).to.be.revertedWith(
        'URIQueryForNonexistentToken',
      );
    });

    it('Returns should not be able to set baseURI once frozen', async () => {
      await contract.setStages(
        [ethers.utils.parseEther('0.5'), ethers.utils.parseEther('0.6')],
        [10, 10],
        [ethers.utils.hexZeroPad('0x', 32), ethers.utils.hexZeroPad('0x', 32)],
        [5, 10],
      );

      await contract.setBaseURI('base_uri_');
      await contract.setMintable(true);

      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('2.5'),
      });

      expect(await contract.tokenURI(0)).to.equal('base_uri_0');
      expect(await contract.tokenURI(1)).to.equal('base_uri_1');

      await contract.setBaseURI('base_uri_again_');
      expect(await contract.tokenURI(0)).to.equal('base_uri_again_0');

      // readonlyContract should not be able to set baseURI
      await expect(readonlyContract.setBaseURI('something_else_')).to.be.revertedWith('Ownable');

      await expect(contract.setBaseURIPermanent()).to.emit(contract, 'PermanentBaseURI');
      await expect(contract.setBaseURI('base_uri_again_again_')).to.be.revertedWith('CannotUpdatePermanentBaseURI');
    });
  });

  describe('Global wallet limit', function () {
    it('validates global wallet limit in constructor', async () => {
      const ERC721M = await ethers.getContractFactory('ERC721M');
      await expect(
        ERC721M.deploy('Test', 'TEST', '', 100, 1001),
      ).to.be.revertedWith('GlobalWalletLimitOverflow');
    });

    it('sets global wallet limit', async () => {
      await contract.setGlobalWalletLimit(2);
      expect((await contract.getGlobalWalletLimit()).toNumber()).to.equal(2);

      await expect(contract.setGlobalWalletLimit(1001)).to.be.revertedWith(
        'GlobalWalletLimitOverflow',
      );
    });

    it('enforces global wallet limit', async () => {
      await contract.setGlobalWalletLimit(2);
      expect((await contract.getGlobalWalletLimit()).toNumber()).to.equal(2);

      await contract.setStages(
        [ethers.utils.parseEther('0.1')],
        [0],
        [ethers.utils.hexZeroPad('0x', 32)],
        [100],
      );
      await contract.setMintable(true);

      await contract.mint(2, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.2'),
      });

      expect(
        contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
          value: ethers.utils.parseEther('0.1'),
        }),
      ).to.be.revertedWith('WalletGlobalLimitExceeded');
    });
  });

  describe('Token URI suffix', () => {
    it('can set tokenURI suffix', async () => {
      await contract.setMintable(true);
      await contract.setTokenURISuffix('.json');
      await contract.setBaseURI(
        'ipfs://bafybeidntqfipbuvdhdjosntmpxvxyse2dkyfpa635u4g6txruvt5qf7y4/',
      );

      const suffix = await contract.getTokenURISuffix();
      expect(suffix).to.equal('.json');

      await contract.setStages(
        [ethers.utils.parseEther('0.1')],
        [0],
        [ethers.utils.hexZeroPad('0x', 32)],
        [0],
      );

      await contract.mint(1, [ethers.utils.hexZeroPad('0x', 32)], {
        value: ethers.utils.parseEther('0.1'),
      });

      const tokenUri = await contract.tokenURI(0);
      expect(tokenUri).to.equal(
        'ipfs://bafybeidntqfipbuvdhdjosntmpxvxyse2dkyfpa635u4g6txruvt5qf7y4/0.json',
      );
    });
  });
});