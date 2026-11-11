// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {SuiemElections, IBurnableERC20} from "../src/SuiemElections.sol";

/// @notice Deploys SuiemElections to Robinhood Chain MAINNET 4663 (real value). Run ONLY via
///         `pnpm contracts:deploy:mainnet`, which checks PO approval, $WIF identity and the deployer
///         balance first, and writes deployments/4663.json.
contract DeployMainnet is Script {
    uint256 internal constant MAINNET = 4663;
    /// $WIF (VERIFIED_FACTS W-12, W-16). Hard-coded: never taken from input.
    address internal constant WIF = 0x5173b8eA6923c2d40267890D45C46a3480954773;

    function run() external {
        require(block.chainid == MAINNET, "DeployMainnet: chain 4663 only");
        require(
            keccak256(bytes(vm.envString("CONFIRM_MAINNET_DEPLOY"))) == keccak256("I_HAVE_PO_APPROVAL"),
            "DeployMainnet: CONFIRM_MAINNET_DEPLOY=I_HAVE_PO_APPROVAL required"
        );
        uint256 pk = vm.envUint("MAINNET_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);
        SuiemElections el = new SuiemElections(deployer, IBurnableERC20(WIF));
        vm.stopBroadcast();
        console.log("SuiemElections", address(el));
    }
}
