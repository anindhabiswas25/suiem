// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {DemoStockToken} from "../src/DemoStockToken.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {SuiemDemoVenue} from "../src/SuiemDemoVenue.sol";

/// @notice Deploys the Suiem testnet demo venue. TESTNET 46630 ONLY (the keys are testnet-only).
///         Run via `pnpm contracts:deploy:testnet`, which also writes deployments/46630.json.
contract DeployTestnet is Script {
    uint256 internal constant TESTNET = 46630;

    function run() external {
        require(block.chainid == TESTNET, "DeployTestnet: chain 46630 only");
        uint256 pk = vm.envUint("TESTNET_DEPLOYER_PRIVATE_KEY");
        address quoteSigner = vm.envAddress("QUOTE_SIGNER_ADDRESS");
        address deployer = vm.addr(pk);
        string[5] memory tickers = ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"];

        vm.startBroadcast(pk);
        SuiemDemoVenue venue = new SuiemDemoVenue(deployer, quoteSigner);
        DemoUSD dusd = new DemoUSD(address(venue));
        venue.setDemoUSD(dusd);
        for (uint256 i = 0; i < tickers.length; i++) {
            DemoStockToken t = new DemoStockToken(tickers[i], address(venue));
            venue.setListed(address(t), true);
            console.log(string.concat("d", tickers[i]), address(t));
        }
        vm.stopBroadcast();
        console.log("SuiemDemoVenue", address(venue));
        console.log("DemoUSD", address(dusd));
    }
}
