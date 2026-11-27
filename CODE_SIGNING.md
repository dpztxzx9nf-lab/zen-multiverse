# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Official Windows installers of Xenia are built from this public repository by GitHub Actions on GitHub-hosted runners, then signed through SignPath. Only those builds, published on the [GitHub Releases](https://github.com/dpztxzx9nf-lab/zen-multiverse/releases) page, are official. Each signing request is approved by hand. Please download only from that page, and check the `SHA256SUMS.txt` file attached to the release if you want to confirm the file you have is the same one we published.

## Team roles

- **Authors** (people trusted to change the code in this repository): [dpztxzx9nf-lab](https://github.com/dpztxzx9nf-lab)
- **Reviewers** (review changes from anyone who is not a committer): [dpztxzx9nf-lab](https://github.com/dpztxzx9nf-lab)
- **Approvers** (approve each request to code-sign a release): [dpztxzx9nf-lab](https://github.com/dpztxzx9nf-lab)

This is a one-person project today. The same maintainer writes the code, reviews incoming changes, and approves signing.

## Privacy

The desktop app may contact GitHub Releases to check for and download updates. It does not send your name, email, save games, or other personal information to us. Game saves stay on your computer.

This program will not transfer personal information to other networked systems unless you use a feature that needs the network (for example, checking for an update, or playing with a friend). From version 0.2.8 you can choose to play with a friend: if you sign in, the game sends your email address to our server so we can email you a one-time sign-in code, and play in a shared world goes through that server. You can keep playing alone without signing in.

Windows signed by SignPath Foundation will show **SignPath Foundation** as the publisher of the installer. The app itself is made by ThinkCore.
